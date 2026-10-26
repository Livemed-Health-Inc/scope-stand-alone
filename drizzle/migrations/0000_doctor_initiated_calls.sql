ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS initiated_by text NOT NULL DEFAULT 'nurse';
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'call';

CREATE OR REPLACE FUNCTION public.my_bedside_stations()
RETURNS TABLE(device_id uuid, label text, site_id uuid, hospital text, unit text, last_seen timestamptz, online boolean, busy boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.label, s.id, s.hospital, s.unit, d.last_seen,
         COALESCE(d.last_seen > now() - interval '2 minutes', false),
         EXISTS (SELECT 1 FROM public.calls c WHERE c.device_id = d.id
                 AND (c.status = 'accepted' OR (c.status = 'ringing' AND c.created_at > now() - interval '45 seconds')))
  FROM public.doctor_assignments da
  JOIN public.hospital_sites s ON s.id = da.site_id AND s.is_active
  JOIN public.devices d ON d.site_id = s.id AND d.status = 'active' AND d.label <> 'Admin preview'
  WHERE da.doctor_id = auth.uid() AND da.is_active
    AND public.has_role(auth.uid(), 'doctor')
  ORDER BY s.hospital, s.unit, d.label;
$$;

CREATE OR REPLACE FUNCTION public.doctor_call_device(_device_id uuid, _mode text DEFAULT 'call')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.hospital_sites; new_id uuid; _m text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'doctor') THEN RAISE EXCEPTION 'Physicians only'; END IF;
  SELECT st.* INTO s FROM public.devices d
    JOIN public.hospital_sites st ON st.id = d.site_id AND st.is_active
    JOIN public.doctor_assignments da ON da.site_id = st.id AND da.doctor_id = auth.uid() AND da.is_active
   WHERE d.id = _device_id AND d.status = 'active';
  IF s.id IS NULL THEN RAISE EXCEPTION 'You are not assigned to this bedside station'; END IF;
  _m := CASE WHEN _mode = 'drop_in' THEN 'drop_in' ELSE 'call' END;
  UPDATE public.calls SET status = 'missed', ended_at = now()
   WHERE device_id = _device_id AND status = 'ringing' AND created_at <= now() - interval '45 seconds';
  INSERT INTO public.calls (nurse_id, doctor_id, status, reason, hospital, unit, device_id, initiated_by, mode)
  VALUES (NULL, auth.uid(), 'ringing', CASE WHEN _m = 'drop_in' THEN 'Physician drop-in' ELSE 'Physician call' END,
          s.hospital, s.unit, _device_id, 'doctor', _m)
  RETURNING id INTO new_id;
  INSERT INTO public.call_events(call_id, doctor_id, device_id, actor, kind, site)
  VALUES (new_id, auth.uid(), _device_id, 'doctor', 'doctor_' || _m, left(s.hospital, 64));
  RETURN new_id;
END; $$;

CREATE OR REPLACE FUNCTION public.device_incoming_call(_device_token text)
RETURNS TABLE(id uuid, doctor_id uuid, doctor_name text, specialty text, mode text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RETURN; END IF;
  UPDATE public.devices SET last_seen = now() WHERE public.devices.id = d.id;
  RETURN QUERY
    SELECT c.id, c.doctor_id, COALESCE(p.full_name, 'Physician'), p.specialty, c.mode, c.created_at
    FROM public.calls c LEFT JOIN public.profiles p ON p.id = c.doctor_id
    WHERE c.device_id = d.id AND c.initiated_by = 'doctor' AND c.status = 'ringing'
      AND c.created_at > now() - interval '45 seconds'
    ORDER BY c.created_at DESC LIMIT 1;
END; $$;

CREATE OR REPLACE FUNCTION public.answer_public_call(_device_token text, _call_id uuid, _accept boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device not registered'; END IF;
  IF _accept THEN
    UPDATE public.calls SET status = 'accepted', answered_at = now()
     WHERE id = _call_id AND device_id = d.id AND status = 'ringing';
  ELSE
    UPDATE public.calls SET status = 'declined', ended_at = now()
     WHERE id = _call_id AND device_id = d.id AND status = 'ringing';
  END IF;
END; $$;

REVOKE ALL ON FUNCTION public.my_bedside_stations() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.doctor_call_device(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_bedside_stations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.doctor_call_device(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.device_incoming_call(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.answer_public_call(text, uuid, boolean) TO anon, authenticated;