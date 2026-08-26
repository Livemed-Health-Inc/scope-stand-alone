CREATE OR REPLACE FUNCTION public.auscultation_breakdown(_since timestamp with time zone DEFAULT (now() - '90 days'::interval))
 RETURNS TABLE(site text, uses bigint, seconds bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admins only'; END IF;
  RETURN QUERY
  SELECT COALESCE(NULLIF(e.site, ''), 'Unspecified'),
         COUNT(*)::bigint,
         (COALESCE(SUM(e.duration_ms), 0) / 1000)::bigint
  FROM public.call_events e
  JOIN public.calls c ON c.id = e.call_id
  WHERE e.occurred_at >= _since
    AND e.kind = 'stethoscope_session'
    AND e.duration_ms > 0
  GROUP BY 1
  ORDER BY 2 DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consult_analytics_detail(_bucket text DEFAULT 'day'::text, _since timestamp with time zone DEFAULT (now() - '90 days'::interval))
 RETURNS TABLE(period timestamp with time zone, specialty text, doctor_id uuid, doctor_name text, hospital text, unit text, placed bigint, answered bigint, missed bigint, total_seconds bigint, wait_seconds bigint, steth_seconds bigint, ausc_events bigint, recordings bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _b text;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Admins only'; END IF;
  _b := CASE lower(coalesce(_bucket, 'day'))
          WHEN 'week' THEN 'week' WHEN 'month' THEN 'month' WHEN 'year' THEN 'year' ELSE 'day' END;

  RETURN QUERY
  WITH ev AS (
    SELECT e.call_id,
           SUM(CASE WHEN e.kind = 'stethoscope_session' THEN e.duration_ms ELSE 0 END)::bigint AS steth_ms,
           COUNT(*) FILTER (WHERE e.kind = 'stethoscope_session' AND e.duration_ms > 0)::bigint AS ausc,
           COUNT(*) FILTER (WHERE e.kind = 'recording')::bigint AS recs
    FROM public.call_events e
    WHERE e.occurred_at >= _since AND e.call_id IS NOT NULL
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
$function$;