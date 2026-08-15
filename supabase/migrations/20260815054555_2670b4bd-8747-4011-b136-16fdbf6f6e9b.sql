ALTER TABLE public.doctor_presence ADD COLUMN IF NOT EXISTS ready_to_round boolean NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.on_call_directory(text);

CREATE OR REPLACE FUNCTION public.on_call_directory(_device_token text)
 RETURNS TABLE(id uuid, full_name text, specialty text, is_online boolean, in_consult boolean, ready_to_round boolean, last_seen timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE d public.devices;
BEGIN
  d := public.device_from_token(_device_token);
  IF d.id IS NULL THEN RAISE EXCEPTION 'Device not registered'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hospital_sites s WHERE s.id = d.site_id AND s.is_active) THEN
    RAISE EXCEPTION 'This hospital is not active';
  END IF;
  RETURN QUERY
    SELECT p.id, p.full_name, p.specialty,
           COALESCE(dp.is_online, false), COALESCE(dp.in_consult, false),
           COALESCE(dp.ready_to_round, false), dp.last_seen
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'doctor'
    LEFT JOIN public.doctor_presence dp ON dp.user_id = p.id
    WHERE NOT EXISTS (SELECT 1 FROM public.doctor_assignments da WHERE da.site_id = d.site_id AND da.is_active)
       OR EXISTS (SELECT 1 FROM public.doctor_assignments da
                  WHERE da.site_id = d.site_id AND da.doctor_id = p.id AND da.is_active);
END;
$function$;