CREATE TABLE IF NOT EXISTS public.call_events (
  id bigserial PRIMARY KEY,
  call_id uuid REFERENCES public.calls(id) ON DELETE CASCADE,
  doctor_id uuid,
  device_id uuid,
  actor text NOT NULL DEFAULT 'unknown',
  kind text NOT NULL,
  site text,
  duration_ms integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_events_occurred_idx ON public.call_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS call_events_call_idx ON public.call_events(call_id);
CREATE INDEX IF NOT EXISTS calls_created_idx ON public.calls(created_at DESC);

GRANT SELECT ON public.call_events TO authenticated;
GRANT ALL ON public.call_events TO service_role;
ALTER TABLE public.call_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read call events" ON public.call_events;
CREATE POLICY "Admins read call events" ON public.call_events
FOR SELECT TO authenticated
USING (public.is_admin(auth.uid()));

-- Recording API: usable by bedside devices (anon + device token) and doctors.
CREATE OR REPLACE FUNCTION public.log_call_event(
  _kind text,
  _call_id uuid DEFAULT NULL,
  _site text DEFAULT NULL,
  _duration_ms integer DEFAULT 0,
  _details jsonb DEFAULT '{}'::jsonb,
  _device_token text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _dev public.devices; _actor text; _doc uuid;
BEGIN
  IF _device_token IS NOT NULL THEN
    SELECT * INTO _dev FROM public.device_from_token(_device_token);
  END IF;

  IF auth.uid() IS NOT NULL THEN
    _actor := 'doctor';
    _doc := auth.uid();
  ELSIF _dev.id IS NOT NULL THEN
    _actor := 'bedside';
  ELSE
    RETURN; -- unauthenticated + unknown device: drop silently
  END IF;

  INSERT INTO public.call_events(call_id, doctor_id, device_id, actor, kind, site, duration_ms, details)
  VALUES (_call_id, _doc, _dev.id, _actor, left(_kind, 64), left(_site, 64),
          GREATEST(0, LEAST(coalesce(_duration_ms, 0), 24 * 3600 * 1000)), coalesce(_details, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.log_call_event(text, uuid, text, integer, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_call_event(text, uuid, text, integer, jsonb, text) TO anon, authenticated;

-- Rich analytics rollup
CREATE OR REPLACE FUNCTION public.consult_analytics_detail(
  _bucket text DEFAULT 'day',
  _since timestamptz DEFAULT (now() - interval '90 days')
) RETURNS TABLE(
  period timestamptz,
  specialty text,
  doctor_id uuid,
  doctor_name text,
  hospital text,
  unit text,
  placed bigint,
  answered bigint,
  missed bigint,
  total_seconds bigint,
  wait_seconds bigint,
  steth_seconds bigint,
  ausc_events bigint,
  recordings bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _b text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admins only'; END IF;
  _b := CASE lower(coalesce(_bucket, 'day'))
          WHEN 'week' THEN 'week' WHEN 'month' THEN 'month' WHEN 'year' THEN 'year' ELSE 'day' END;

  RETURN QUERY
  WITH ev AS (
    SELECT e.call_id,
           SUM(CASE WHEN e.kind = 'stethoscope_session' THEN e.duration_ms ELSE 0 END)::bigint AS steth_ms,
           COUNT(*) FILTER (WHERE e.kind = 'auscultation_site')::bigint AS ausc,
           COUNT(*) FILTER (WHERE e.kind = 'recording')::bigint AS recs
    FROM public.call_events e
    WHERE e.occurred_at >= _since
    GROUP BY e.call_id
  )
  SELECT date_trunc(_b, c.created_at),
         COALESCE(NULLIF(p.specialty, ''), 'Unassigned'),
         c.doctor_id,
         COALESCE(NULLIF(p.full_name, ''), 'Unassigned'),
         COALESCE(NULLIF(c.hospital, ''), 'Unknown'),
         COALESCE(NULLIF(c.unit, ''), '—'),
         COUNT(*)::bigint,
         COUNT(*) FILTER (WHERE c.answered_at IS NOT NULL)::bigint,
         COUNT(*) FILTER (WHERE c.answered_at IS NULL)::bigint,
         COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (c.ended_at - c.answered_at))))::bigint, 0),
         COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (c.answered_at - c.created_at))))::bigint, 0),
         COALESCE(SUM(ev.steth_ms) / 1000, 0)::bigint,
         COALESCE(SUM(ev.ausc), 0)::bigint,
         COALESCE(SUM(ev.recs), 0)::bigint
  FROM public.calls c
  LEFT JOIN public.profiles p ON p.id = c.doctor_id
  LEFT JOIN ev ON ev.call_id = c.id
  WHERE c.created_at >= _since
  GROUP BY 1, 2, 3, 4, 5, 6
  ORDER BY 1 DESC, 7 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.consult_analytics_detail(text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consult_analytics_detail(text, timestamptz) TO authenticated;

-- Auscultation site usage breakdown
CREATE OR REPLACE FUNCTION public.auscultation_breakdown(
  _since timestamptz DEFAULT (now() - interval '90 days')
) RETURNS TABLE(site text, uses bigint, seconds bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN QUERY
  SELECT COALESCE(NULLIF(e.site, ''), 'Unspecified'),
         COUNT(*)::bigint,
         (COALESCE(SUM(e.duration_ms), 0) / 1000)::bigint
  FROM public.call_events e
  WHERE e.occurred_at >= _since AND e.kind IN ('auscultation_site', 'stethoscope_session')
  GROUP BY 1
  ORDER BY 2 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.auscultation_breakdown(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auscultation_breakdown(timestamptz) TO authenticated;