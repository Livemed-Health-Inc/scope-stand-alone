CREATE OR REPLACE FUNCTION public.admin_preview_device(_site_id uuid)
RETURNS TABLE(device_token text, hospital text, unit text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s public.hospital_sites;
  new_token text;
  dev_id uuid;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Admins only';
  END IF;

  SELECT * INTO s FROM public.hospital_sites WHERE id = _site_id AND is_active;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'This hospital unit is not active';
  END IF;

  new_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  SELECT d.id INTO dev_id FROM public.devices d
   WHERE d.site_id = s.id AND d.label = 'Admin preview'
   ORDER BY d.created_at LIMIT 1;

  IF dev_id IS NULL THEN
    INSERT INTO public.devices (site_id, label, token_hash, status, last_seen)
    VALUES (s.id, 'Admin preview', encode(sha256(convert_to(new_token, 'UTF8')), 'hex'), 'active', now())
    RETURNING id INTO dev_id;
  ELSE
    UPDATE public.devices
       SET token_hash = encode(sha256(convert_to(new_token, 'UTF8')), 'hex'),
           status = 'active',
           last_seen = now()
     WHERE id = dev_id;
  END IF;

  RETURN QUERY SELECT new_token, s.hospital, s.unit;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_preview_device(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_preview_device(uuid) TO authenticated;