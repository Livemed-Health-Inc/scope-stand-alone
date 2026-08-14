DROP POLICY "Nurses create calls" ON public.calls;
CREATE POLICY "Nurses create calls" ON public.calls FOR INSERT TO authenticated WITH CHECK (auth.uid() = nurse_id);