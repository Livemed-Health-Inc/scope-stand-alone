CREATE TABLE public.permissions (
  key text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'General',
  sort_order int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read permissions" ON public.permissions FOR SELECT TO authenticated USING (true);

CREATE TABLE public.role_permissions (
  role public.app_role NOT NULL,
  permission_key text NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, permission_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read role permissions" ON public.role_permissions FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;
REVOKE ALL ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;

CREATE POLICY "Admins manage role permissions" ON public.role_permissions
FOR ALL TO authenticated
USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text IN ('admin', 'system_admin', 'super_admin')
  )
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role::text <> 'patient'
  )
$$;

CREATE OR REPLACE FUNCTION public.has_permission(_user_id uuid, _key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_permissions rp ON rp.role = ur.role
    WHERE ur.user_id = _user_id AND rp.permission_key = _key
  )
$$;
REVOKE ALL ON FUNCTION public.has_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_permissions()
RETURNS TABLE(permission_key text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT DISTINCT rp.permission_key
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role = ur.role
  WHERE ur.user_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.my_permissions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_permissions() TO authenticated;

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles
FOR ALL TO authenticated
USING (public.is_admin(auth.uid()) AND (role::text <> 'super_admin' OR public.is_super_admin(auth.uid())))
WITH CHECK (public.is_admin(auth.uid()) AND (role::text <> 'super_admin' OR public.is_super_admin(auth.uid())));

CREATE OR REPLACE FUNCTION public.available_physicians()
RETURNS TABLE(id uuid, full_name text, specialty text, is_online boolean, in_consult boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id, p.full_name, p.specialty,
         COALESCE(dp.is_online, false), COALESCE(dp.in_consult, false)
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'doctor'
  LEFT JOIN public.doctor_presence dp ON dp.user_id = p.id
  WHERE public.has_permission(auth.uid(), 'patient.visit')
     OR public.is_staff(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.available_physicians() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.available_physicians() TO authenticated;

INSERT INTO public.permissions (key, label, category, sort_order) VALUES
  ('nurse.station', 'Bedside nurse station', 'Clinical', 10),
  ('nurse.rounding', 'Rounding alerts', 'Clinical', 20),
  ('doctor.station', 'Physician waiting room', 'Clinical', 30),
  ('doctor.consult', 'Join A/V + stethoscope consult', 'Clinical', 40),
  ('patient.visit', 'Request a virtual visit', 'Patient', 50),
  ('tech.provision', 'Activate facilities and devices', 'Field ops', 60),
  ('analytics.view', 'View consult analytics', 'Analytics', 70),
  ('admin.hospitals', 'Manage hospitals and devices', 'Administration', 80),
  ('admin.physicians', 'Manage physician assignments', 'Administration', 90),
  ('admin.techs', 'Manage field technicians', 'Administration', 100),
  ('admin.users', 'Manage users and personas', 'Administration', 110),
  ('admin.roles', 'Edit persona permissions', 'Administration', 120)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key)
SELECT 'hospital'::public.app_role, k FROM unnest(ARRAY['nurse.station','nurse.rounding']) k
UNION ALL SELECT 'nurse'::public.app_role, k FROM unnest(ARRAY['nurse.station','nurse.rounding']) k
UNION ALL SELECT 'doctor'::public.app_role, k FROM unnest(ARRAY['doctor.station','doctor.consult','nurse.rounding']) k
UNION ALL SELECT 'patient'::public.app_role, k FROM unnest(ARRAY['patient.visit','doctor.consult']) k
UNION ALL SELECT 'tech'::public.app_role, k FROM unnest(ARRAY['tech.provision']) k
UNION ALL SELECT 'analytics'::public.app_role, k FROM unnest(ARRAY['analytics.view']) k
UNION ALL SELECT 'admin'::public.app_role, k FROM unnest(ARRAY['analytics.view','admin.hospitals','admin.physicians','admin.techs','admin.users']) k
UNION ALL SELECT 'system_admin'::public.app_role, k FROM unnest(ARRAY['tech.provision','analytics.view','admin.hospitals','admin.physicians','admin.techs','admin.users']) k
UNION ALL SELECT 'super_admin'::public.app_role, key FROM public.permissions
ON CONFLICT DO NOTHING;