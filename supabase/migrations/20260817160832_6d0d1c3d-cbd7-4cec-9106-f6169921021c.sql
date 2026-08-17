CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;

REVOKE ALL ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Staff can view all profiles" ON public.profiles;
CREATE POLICY "Staff and self can view profiles" ON public.profiles
FOR SELECT TO authenticated
USING (auth.uid() = id OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff can view presence" ON public.doctor_presence;
CREATE POLICY "Staff and self can view presence" ON public.doctor_presence
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "Staff can view roles" ON public.user_roles;
CREATE POLICY "Users view own roles, admins view all" ON public.user_roles
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.device_from_token(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_tech(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_admin_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_staff_role(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_enrollment_code(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consult_analytics(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tech(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_admin_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_staff_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_enrollment_code(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consult_analytics(text, timestamptz) TO authenticated;