CREATE TABLE public.unit_nurses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.hospital_sites(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone_e164 text,
  is_active boolean NOT NULL DEFAULT true,
  totp_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_nurses TO authenticated;
GRANT ALL ON public.unit_nurses TO service_role;
ALTER TABLE public.unit_nurses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage unit nurses" ON public.unit_nurses FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
CREATE INDEX unit_nurses_site_idx ON public.unit_nurses(site_id);

-- Server-only secrets and codes: no client grants.
CREATE TABLE public.nurse_totp (
  nurse_id uuid PRIMARY KEY REFERENCES public.unit_nurses(id) ON DELETE CASCADE,
  secret text NOT NULL,
  pending boolean NOT NULL DEFAULT true,
  last_step bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.nurse_totp TO service_role;
ALTER TABLE public.nurse_totp ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.nurse_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nurse_id uuid NOT NULL REFERENCES public.unit_nurses(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  code_hash text,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);
GRANT ALL ON public.nurse_otps TO service_role;
ALTER TABLE public.nurse_otps ENABLE ROW LEVEL SECURITY;
CREATE INDEX nurse_otps_lookup ON public.nurse_otps(nurse_id, device_id, sent_at DESC);

CREATE TABLE public.nurse_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  nurse_id uuid NOT NULL REFERENCES public.unit_nurses(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.nurse_sessions TO service_role;
ALTER TABLE public.nurse_sessions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS nurse_staff_id uuid, ADD COLUMN IF NOT EXISTS nurse_name text;

CREATE OR REPLACE FUNCTION public.device_nurses(_device_token text)
RETURNS TABLE(id uuid, full_name text, phone_last4 text, has_sms boolean, has_totp boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT n.id, n.full_name, right(n.phone_e164, 4), n.phone_e164 IS NOT NULL, n.totp_confirmed_at IS NOT NULL
    FROM public.unit_nurses n WHERE n.site_id = d.site_id AND n.is_active ORDER BY n.full_name;
END; $$;
REVOKE ALL ON FUNCTION public.device_nurses(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.device_nurses(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.nurse_from_session(_device_token text, _session text)
RETURNS TABLE(nurse_id uuid, full_name text, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT n.id, n.full_name, s.expires_at FROM public.nurse_sessions s
    JOIN public.unit_nurses n ON n.id = s.nurse_id
    WHERE s.token_hash = encode(sha256(convert_to(coalesce(_session,''), 'UTF8')), 'hex')
      AND s.device_id = d.id AND s.ended_at IS NULL AND s.expires_at > now() AND n.is_active;
END; $$;
REVOKE ALL ON FUNCTION public.nurse_from_session(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nurse_from_session(text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.end_nurse_session(_device_token text, _session text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RETURN; END IF;
  UPDATE public.nurse_sessions SET ended_at = now()
   WHERE token_hash = encode(sha256(convert_to(coalesce(_session,''), 'UTF8')), 'hex') AND device_id = d.id AND ended_at IS NULL;
END; $$;
REVOKE ALL ON FUNCTION public.end_nurse_session(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_nurse_session(text, text) TO anon, authenticated;

DROP FUNCTION IF EXISTS public.place_public_call(text, uuid, text, text, text, text, text, text[]);
CREATE FUNCTION public.place_public_call(_device_token text, _doctor_id uuid, _patient_room text, _reason text DEFAULT NULL, _patient_name text DEFAULT NULL, _mrn text DEFAULT NULL, _acuity text DEFAULT NULL, _specialties text[] DEFAULT NULL, _nurse_session text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d public.devices; s public.hospital_sites; new_id uuid; nid uuid; nname text;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device not registered'; END IF;
  SELECT * INTO s FROM public.hospital_sites WHERE id = d.site_id AND is_active;
  IF s.id IS NULL THEN RAISE EXCEPTION 'This hospital is not active'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _doctor_id AND role = 'doctor') THEN
    RAISE EXCEPTION 'Unknown physician';
  END IF;
  IF _acuity IS NOT NULL AND _acuity NOT IN ('critical','urgent','routine') THEN RAISE EXCEPTION 'Invalid acuity'; END IF;
  IF _nurse_session IS NOT NULL THEN
    SELECT ns.nurse_id, ns.full_name INTO nid, nname FROM public.nurse_from_session(_device_token, _nurse_session) ns;
  END IF;
  UPDATE public.devices SET last_seen = now() WHERE id = d.id;
  INSERT INTO public.calls (nurse_id, doctor_id, status, patient_room, reason, hospital, unit, device_id, patient_name, mrn, acuity, specialties, nurse_staff_id, nurse_name)
  VALUES (NULL, _doctor_id, 'ringing', left(_patient_room, 40), left(_reason, 1000), s.hospital, s.unit, d.id,
          left(_patient_name, 120), left(_mrn, 40), _acuity, _specialties[1:5], nid, nname)
  RETURNING id INTO new_id;
  RETURN new_id;
END; $$;
REVOKE ALL ON FUNCTION public.place_public_call(text, uuid, text, text, text, text, text, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_public_call(text, uuid, text, text, text, text, text, text[], text) TO anon, authenticated;