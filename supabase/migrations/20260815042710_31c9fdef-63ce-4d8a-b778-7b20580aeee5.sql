ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'admin';

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text = 'admin'
  )
$$;

DROP POLICY IF EXISTS "Doctors manage sites" ON public.hospital_sites;
DROP POLICY IF EXISTS "Doctors manage devices" ON public.devices;
DROP POLICY IF EXISTS "Doctors manage codes" ON public.enrollment_codes;

CREATE POLICY "Admins manage sites" ON public.hospital_sites
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins manage devices" ON public.devices
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Admins manage codes" ON public.enrollment_codes
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.create_enrollment_code(_site_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _code text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only admins can issue enrollment codes';
  END IF;
  _code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  INSERT INTO public.enrollment_codes (code, site_id, created_by)
  VALUES (_code, _site_id, auth.uid());
  RETURN _code;
END;
$$;