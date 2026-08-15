-- Sites
CREATE TABLE public.hospital_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hospital text NOT NULL,
  unit text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospital_sites TO authenticated;
GRANT ALL ON public.hospital_sites TO service_role;
ALTER TABLE public.hospital_sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors manage sites" ON public.hospital_sites FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'doctor')) WITH CHECK (public.has_role(auth.uid(), 'doctor'));

-- Devices
CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.hospital_sites(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Bedside tablet',
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  last_seen timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors manage devices" ON public.devices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'doctor')) WITH CHECK (public.has_role(auth.uid(), 'doctor'));

-- Enrollment codes
CREATE TABLE public.enrollment_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  site_id uuid NOT NULL REFERENCES public.hospital_sites(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  used_at timestamptz,
  device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.enrollment_codes TO authenticated;
GRANT ALL ON public.enrollment_codes TO service_role;
ALTER TABLE public.enrollment_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Doctors manage codes" ON public.enrollment_codes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'doctor')) WITH CHECK (public.has_role(auth.uid(), 'doctor'));

ALTER TABLE public.calls ADD COLUMN device_id uuid REFERENCES public.devices(id) ON DELETE SET NULL;

-- Helper: resolve an active device from a raw token
CREATE OR REPLACE FUNCTION public.device_from_token(_token text)
RETURNS public.devices
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT d.* FROM public.devices d
  WHERE d.token_hash = encode(sha256(convert_to(coalesce(_token,''), 'UTF8')), 'hex')
    AND d.status = 'active'
$$;
REVOKE EXECUTE ON FUNCTION public.device_from_token(text) FROM public, anon, authenticated;

-- Admin: create an enrollment code
CREATE OR REPLACE FUNCTION public.create_enrollment_code(_site_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE new_code text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'doctor') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.enrollment_codes (code, site_id, created_by) VALUES (new_code, _site_id, auth.uid());
  RETURN new_code;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_enrollment_code(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_enrollment_code(uuid) TO authenticated;

-- Device enrollment (anon)
CREATE OR REPLACE FUNCTION public.redeem_enrollment_code(_code text, _label text DEFAULT 'Bedside tablet')
RETURNS TABLE(device_token text, hospital text, unit text, label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  ec public.enrollment_codes;
  new_token text;
  new_device_id uuid;
BEGIN
  SELECT * INTO ec FROM public.enrollment_codes
  WHERE code = upper(trim(coalesce(_code, ''))) AND used_at IS NULL AND expires_at > now();
  IF ec.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired enrollment code';
  END IF;

  new_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.devices (site_id, label, token_hash, last_seen)
  VALUES (ec.site_id, left(coalesce(nullif(trim(_label), ''), 'Bedside tablet'), 80),
          encode(sha256(convert_to(new_token, 'UTF8')), 'hex'), now())
  RETURNING id INTO new_device_id;

  UPDATE public.enrollment_codes SET used_at = now(), device_id = new_device_id WHERE id = ec.id;

  RETURN QUERY
    SELECT new_token, s.hospital, s.unit, d.label
    FROM public.devices d JOIN public.hospital_sites s ON s.id = d.site_id
    WHERE d.id = new_device_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.redeem_enrollment_code(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.redeem_enrollment_code(text, text) TO anon, authenticated;

-- Device session check (anon)
CREATE OR REPLACE FUNCTION public.device_context(_device_token text)
RETURNS TABLE(device_id uuid, hospital text, unit text, label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RETURN; END IF;
  UPDATE public.devices SET last_seen = now() WHERE id = d.id;
  RETURN QUERY SELECT d.id, s.hospital, s.unit, d.label
  FROM public.hospital_sites s WHERE s.id = d.site_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.device_context(text) FROM public;
GRANT EXECUTE ON FUNCTION public.device_context(text) TO anon, authenticated;

-- Nurse-side functions now require a device token
DROP FUNCTION IF EXISTS public.on_call_directory();
CREATE OR REPLACE FUNCTION public.on_call_directory(_device_token text)
RETURNS TABLE(id uuid, full_name text, specialty text, is_online boolean, in_consult boolean, last_seen timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device not registered'; END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.specialty,
           COALESCE(dp.is_online, false), COALESCE(dp.in_consult, false), dp.last_seen
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'doctor'
    LEFT JOIN public.doctor_presence dp ON dp.user_id = p.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.on_call_directory(text) FROM public;
GRANT EXECUTE ON FUNCTION public.on_call_directory(text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.place_public_call(uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION public.place_public_call(_device_token text, _doctor_id uuid, _patient_room text, _reason text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  d public.devices;
  s public.hospital_sites;
  new_id uuid;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device not registered'; END IF;
  SELECT * INTO s FROM public.hospital_sites WHERE id = d.site_id;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _doctor_id AND role = 'doctor') THEN
    RAISE EXCEPTION 'Unknown physician';
  END IF;

  UPDATE public.devices SET last_seen = now() WHERE id = d.id;

  INSERT INTO public.calls (nurse_id, doctor_id, status, patient_room, reason, hospital, unit, device_id)
  VALUES (NULL, _doctor_id, 'ringing', left(_patient_room, 40), left(_reason, 300), s.hospital, s.unit, d.id)
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.place_public_call(text, uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.place_public_call(text, uuid, text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.get_public_call(uuid);
CREATE OR REPLACE FUNCTION public.get_public_call(_device_token text, _call_id uuid)
RETURNS TABLE(id uuid, doctor_id uuid, status text, patient_room text, reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT c.id, c.doctor_id, c.status, c.patient_room, c.reason
    FROM public.calls c WHERE c.id = _call_id AND c.device_id = d.id;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_public_call(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_call(text, uuid) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.end_public_call(uuid);
CREATE OR REPLACE FUNCTION public.end_public_call(_device_token text, _call_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RETURN; END IF;
  UPDATE public.calls SET status = 'ended', ended_at = now()
  WHERE id = _call_id AND device_id = d.id AND status <> 'ended';
END;
$$;
REVOKE EXECUTE ON FUNCTION public.end_public_call(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.end_public_call(text, uuid) TO anon, authenticated;