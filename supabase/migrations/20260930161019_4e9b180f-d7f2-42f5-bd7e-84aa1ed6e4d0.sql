DROP POLICY IF EXISTS "Signed-in users read role permissions" ON public.role_permissions;
CREATE POLICY "Users read own role permissions" ON public.role_permissions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = role_permissions.role) OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Signed-in users read permissions" ON public.permissions;
CREATE POLICY "Users read own permissions" ON public.permissions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.user_roles ur ON ur.role = rp.role WHERE ur.user_id = auth.uid() AND rp.permission_key = permissions.key));