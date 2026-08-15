CREATE TABLE public.rounding_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid REFERENCES public.devices(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.hospital_sites(id) ON DELETE SET NULL,
  hospital text NOT NULL,
  unit text NOT NULL,
  room text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'ready',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  cleared_at timestamp with time zone,
  cleared_by uuid
);

GRANT SELECT, UPDATE ON public.rounding_queue TO authenticated;
GRANT ALL ON public.rounding_queue TO service_role;

ALTER TABLE public.rounding_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff view rounding queue" ON public.rounding_queue
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff update rounding queue" ON public.rounding_queue
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_rounding_queue_updated_at
  BEFORE UPDATE ON public.rounding_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE UNIQUE INDEX rounding_queue_active_room
  ON public.rounding_queue (device_id, lower(room))
  WHERE status = 'ready';

-- Nurse (device-token) endpoints
CREATE OR REPLACE FUNCTION public.mark_rounding_ready(_device_token text, _room text, _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  d public.devices;
  s public.hospital_sites;
  new_id uuid;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device not registered'; END IF;
  SELECT * INTO s FROM public.hospital_sites WHERE id = d.site_id;

  INSERT INTO public.rounding_queue (device_id, site_id, hospital, unit, room, note)
  VALUES (d.id, s.id, s.hospital, s.unit, btrim(_room), NULLIF(btrim(coalesce(_note,'')), ''))
  ON CONFLICT (device_id, lower(room)) WHERE status = 'ready'
  DO UPDATE SET note = EXCLUDED.note, updated_at = now()
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.device_rounding(_device_token text)
RETURNS TABLE(id uuid, room text, note text, status text, created_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT r.id, r.room, r.note, r.status, r.created_at
    FROM public.rounding_queue r
    WHERE r.device_id = d.id AND r.status = 'ready'
    ORDER BY r.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_rounding(_device_token text, _id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device not registered'; END IF;
  UPDATE public.rounding_queue
     SET status = 'cleared', cleared_at = now()
   WHERE id = _id AND device_id = d.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_rounding_ready(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.device_rounding(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_rounding(text, uuid) TO anon, authenticated;