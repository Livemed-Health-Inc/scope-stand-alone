GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.user_roles TO anon;
GRANT SELECT ON public.doctor_presence TO anon;
GRANT SELECT, INSERT, UPDATE ON public.calls TO anon;

CREATE POLICY "Public can view profiles" ON public.profiles FOR SELECT TO anon USING (true);
CREATE POLICY "Public can view roles" ON public.user_roles FOR SELECT TO anon USING (true);
CREATE POLICY "Public can view presence" ON public.doctor_presence FOR SELECT TO anon USING (true);

ALTER TABLE public.calls ALTER COLUMN nurse_id DROP NOT NULL;

CREATE POLICY "Public stations create calls" ON public.calls FOR INSERT TO anon WITH CHECK (nurse_id IS NULL);
CREATE POLICY "Public stations view calls" ON public.calls FOR SELECT TO anon USING (nurse_id IS NULL);
CREATE POLICY "Public stations update calls" ON public.calls FOR UPDATE TO anon USING (nurse_id IS NULL) WITH CHECK (nurse_id IS NULL);

DROP POLICY "Participants view calls" ON public.calls;
CREATE POLICY "Participants view calls" ON public.calls FOR SELECT TO authenticated USING (auth.uid() = nurse_id OR auth.uid() = doctor_id);