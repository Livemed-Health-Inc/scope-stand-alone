CREATE TABLE public.bedside_logins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.hospital_sites(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bedside_logins TO authenticated;
GRANT ALL ON public.bedside_logins TO service_role;

ALTER TABLE public.bedside_logins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage bedside logins"
  ON public.bedside_logins FOR ALL TO authenticated
  USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Bedside account views own login"
  ON public.bedside_logins FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER bedside_logins_updated_at
  BEFORE UPDATE ON public.bedside_logins
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.bedside_session_token()
RETURNS TABLE(device_token text, hospital text, unit text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  l public.bedside_logins;
  s public.hospital_sites;
  new_token text;
  dev_id uuid;
  dev_label text;
BEGIN
  SELECT * INTO l FROM public.bedside_logins WHERE user_id = auth.uid();
  IF l.user_id IS NULL THEN
    RAISE EXCEPTION 'This account is not linked to a hospital unit';
  END IF;

  SELECT * INTO s FROM public.hospital_sites WHERE id = l.site_id AND is_active;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'This hospital unit is not active';
  END IF;

  new_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  dev_label := 'Bedside login — ' || l.email;

  SELECT d.id INTO dev_id FROM public.devices d
   WHERE d.site_id = s.id AND d.label = dev_label
   ORDER BY d.created_at LIMIT 1;

  IF dev_id IS NULL THEN
    INSERT INTO public.devices (site_id, label, token_hash, status, last_seen)
    VALUES (s.id, dev_label, encode(sha256(convert_to(new_token, 'UTF8')), 'hex'), 'active', now())
    RETURNING id INTO dev_id;
  ELSE
    IF (SELECT status FROM public.devices WHERE id = dev_id) <> 'active' THEN
      RAISE EXCEPTION 'This bedside login has been revoked';
    END IF;
    UPDATE public.devices
       SET token_hash = encode(sha256(convert_to(new_token, 'UTF8')), 'hex'),
           last_seen = now()
     WHERE id = dev_id;
  END IF;

  RETURN QUERY SELECT new_token, s.hospital, s.unit;
END;
$function$;

REVOKE ALL ON FUNCTION public.bedside_session_token() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bedside_session_token() TO authenticated;