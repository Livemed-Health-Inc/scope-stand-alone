-- 1. Hospitals can be deactivated
ALTER TABLE public.hospital_sites ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 2. Approved LiveMed admin emails
CREATE TABLE IF NOT EXISTS public.admin_allowlist (
  email text PRIMARY KEY,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_allowlist TO authenticated;
GRANT ALL ON public.admin_allowlist TO service_role;
ALTER TABLE public.admin_allowlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage allowlist" ON public.admin_allowlist
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- 3. Doctor assignments to hospital units
CREATE TABLE IF NOT EXISTS public.doctor_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doctor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.hospital_sites(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doctor_id, site_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_assignments TO authenticated;
GRANT ALL ON public.doctor_assignments TO service_role;
ALTER TABLE public.doctor_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage assignments" ON public.doctor_assignments
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));
CREATE POLICY "Doctors view own assignments" ON public.doctor_assignments
FOR SELECT TO authenticated
USING (auth.uid() = doctor_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS update_doctor_assignments_updated_at ON public.doctor_assignments;
CREATE TRIGGER update_doctor_assignments_updated_at
BEFORE UPDATE ON public.doctor_assignments
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Nobody can self-claim admin
DROP POLICY IF EXISTS "Users claim own role" ON public.user_roles;
CREATE POLICY "Users claim staff role" ON public.user_roles
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND role::text IN ('doctor', 'nurse'));
CREATE POLICY "Admins manage roles" ON public.user_roles
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.claim_admin_role()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _email text;
BEGIN
  SELECT lower(email) INTO _email FROM auth.users WHERE id = auth.uid();
  IF _email IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.admin_allowlist a WHERE lower(a.email) = _email) THEN
    RETURN false;
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (auth.uid(), 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN true;
END;
$$;

-- 5. Seed the first LiveMed admin
INSERT INTO public.admin_allowlist (email, note) VALUES ('sohail@livemedhealth.com', 'LiveMed founding admin')
ON CONFLICT (email) DO NOTHING;
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin' FROM auth.users WHERE lower(email) = 'sohail@livemedhealth.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- 6. Inactive hospitals stop their tablets
CREATE OR REPLACE FUNCTION public.device_context(_device_token text)
RETURNS TABLE(device_id uuid, hospital text, unit text, label text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RETURN; END IF;
  UPDATE public.devices SET last_seen = now() WHERE id = d.id;
  RETURN QUERY SELECT d.id, s.hospital, s.unit, d.label
  FROM public.hospital_sites s WHERE s.id = d.site_id AND s.is_active;
END;
$$;

CREATE OR REPLACE FUNCTION public.place_public_call(_device_token text, _doctor_id uuid, _patient_room text, _reason text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d public.devices;
  s public.hospital_sites;
  new_id uuid;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device not registered'; END IF;
  SELECT * INTO s FROM public.hospital_sites WHERE id = d.site_id AND is_active;
  IF s.id IS NULL THEN RAISE EXCEPTION 'This hospital is not active'; END IF;

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

-- 7. Only physicians assigned to the device's active site appear in the directory
CREATE OR REPLACE FUNCTION public.on_call_directory(_device_token text)
RETURNS TABLE(id uuid, full_name text, specialty text, is_online boolean, in_consult boolean, last_seen timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device not registered'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hospital_sites s WHERE s.id = d.site_id AND s.is_active) THEN
    RAISE EXCEPTION 'This hospital is not active';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.specialty,
           COALESCE(dp.is_online, false), COALESCE(dp.in_consult, false), dp.last_seen
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'doctor'
    LEFT JOIN public.doctor_presence dp ON dp.user_id = p.id
    WHERE NOT EXISTS (SELECT 1 FROM public.doctor_assignments da WHERE da.site_id = d.site_id AND da.is_active)
       OR EXISTS (SELECT 1 FROM public.doctor_assignments da
                  WHERE da.site_id = d.site_id AND da.doctor_id = p.id AND da.is_active);
END;
$$;

-- 8. Admin analytics
CREATE OR REPLACE FUNCTION public.consult_analytics(_bucket text DEFAULT 'day', _since timestamptz DEFAULT (now() - interval '90 days'))
RETURNS TABLE(period timestamptz, specialty text, consults bigint, total_seconds bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _b text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admins only'; END IF;
  _b := CASE lower(coalesce(_bucket, 'day'))
          WHEN 'week' THEN 'week' WHEN 'month' THEN 'month' WHEN 'year' THEN 'year' ELSE 'day' END;
  RETURN QUERY
    SELECT date_trunc(_b, c.created_at) AS period,
           COALESCE(NULLIF(p.specialty, ''), 'Unassigned') AS specialty,
           count(*)::bigint AS consults,
           COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(c.ended_at, now()) - COALESCE(c.answered_at, c.created_at)))))::bigint, 0) AS total_seconds
    FROM public.calls c
    LEFT JOIN public.profiles p ON p.id = c.doctor_id
    WHERE c.created_at >= _since AND c.answered_at IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1 DESC, 3 DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consult_analytics(text, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_admin_role() FROM anon;