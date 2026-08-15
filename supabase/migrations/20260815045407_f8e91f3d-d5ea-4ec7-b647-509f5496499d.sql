CREATE TABLE public.tech_allowlist (
  email text PRIMARY KEY,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tech_allowlist TO authenticated;
GRANT ALL ON public.tech_allowlist TO service_role;

ALTER TABLE public.tech_allowlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tech allowlist" ON public.tech_allowlist
  FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.is_tech(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.tech_allowlist t ON lower(t.email) = lower(u.email)
    WHERE u.id = _user_id
  ) OR public.is_admin(_user_id)
$$;

CREATE POLICY "Techs view sites" ON public.hospital_sites
  FOR SELECT TO authenticated
  USING (public.is_tech(auth.uid()));
