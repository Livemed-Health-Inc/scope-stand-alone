ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS patient_name text, ADD COLUMN IF NOT EXISTS mrn text, ADD COLUMN IF NOT EXISTS acuity text, ADD COLUMN IF NOT EXISTS specialties text[];

DROP FUNCTION IF EXISTS public.place_public_call(text, uuid, text, text);

CREATE FUNCTION public.place_public_call(_device_token text, _doctor_id uuid, _patient_room text, _reason text DEFAULT NULL, _patient_name text DEFAULT NULL, _mrn text DEFAULT NULL, _acuity text DEFAULT NULL, _specialties text[] DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d public.devices; s public.hospital_sites; new_id uuid;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device not registered'; END IF;
  SELECT * INTO s FROM public.hospital_sites WHERE id = d.site_id AND is_active;
  IF s.id IS NULL THEN RAISE EXCEPTION 'This hospital is not active'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _doctor_id AND role = 'doctor') THEN
    RAISE EXCEPTION 'Unknown physician';
  END IF;
  IF _acuity IS NOT NULL AND _acuity NOT IN ('critical','urgent','routine') THEN RAISE EXCEPTION 'Invalid acuity'; END IF;
  UPDATE public.devices SET last_seen = now() WHERE id = d.id;
  INSERT INTO public.calls (nurse_id, doctor_id, status, patient_room, reason, hospital, unit, device_id, patient_name, mrn, acuity, specialties)
  VALUES (NULL, _doctor_id, 'ringing', left(_patient_room, 40), left(_reason, 1000), s.hospital, s.unit, d.id,
          left(_patient_name, 120), left(_mrn, 40), _acuity, _specialties[1:5])
  RETURNING id INTO new_id;
  RETURN new_id;
END; $$;

REVOKE ALL ON FUNCTION public.place_public_call(text, uuid, text, text, text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.place_public_call(text, uuid, text, text, text, text, text, text[]) TO anon, authenticated;