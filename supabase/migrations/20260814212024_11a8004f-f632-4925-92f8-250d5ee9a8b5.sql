-- 1. Remove broad anonymous access
DROP POLICY IF EXISTS "Public can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public can view roles" ON public.user_roles;
DROP POLICY IF EXISTS "Public can view presence" ON public.doctor_presence;
DROP POLICY IF EXISTS "Public stations view calls" ON public.calls;
DROP POLICY IF EXISTS "Public stations create calls" ON public.calls;
DROP POLICY IF EXISTS "Public stations update calls" ON public.calls;

REVOKE SELECT ON public.profiles FROM anon;
REVOKE SELECT ON public.user_roles FROM anon;
REVOKE SELECT ON public.doctor_presence FROM anon;
REVOKE SELECT, INSERT, UPDATE ON public.calls FROM anon;

-- 2. Minimal on-call directory for unauthenticated bedside stations
CREATE OR REPLACE FUNCTION public.on_call_directory()
RETURNS TABLE (
  id uuid,
  full_name text,
  specialty text,
  is_online boolean,
  in_consult boolean,
  last_seen timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id,
         p.full_name,
         p.specialty,
         COALESCE(dp.is_online, false),
         COALESCE(dp.in_consult, false),
         dp.last_seen
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'doctor'
  LEFT JOIN public.doctor_presence dp ON dp.user_id = p.id
$$;

GRANT EXECUTE ON FUNCTION public.on_call_directory() TO anon, authenticated;

-- 3. Start a call from an unauthenticated bedside station
CREATE OR REPLACE FUNCTION public.place_public_call(
  _doctor_id uuid,
  _patient_room text,
  _reason text DEFAULT NULL,
  _hospital text DEFAULT NULL,
  _unit text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _doctor_id AND role = 'doctor') THEN
    RAISE EXCEPTION 'Unknown physician';
  END IF;

  INSERT INTO public.calls (nurse_id, doctor_id, status, patient_room, reason, hospital, unit)
  VALUES (NULL, _doctor_id, 'ringing', left(_patient_room, 40), left(_reason, 300), left(_hospital, 120), left(_unit, 120))
  RETURNING id INTO new_id;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.place_public_call(uuid, text, text, text, text) TO anon, authenticated;

-- 4. Read back only the exact call the station created (id acts as capability token)
CREATE OR REPLACE FUNCTION public.get_public_call(_call_id uuid)
RETURNS TABLE (
  id uuid,
  doctor_id uuid,
  status text,
  patient_room text,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.doctor_id, c.status, c.patient_room, c.reason
  FROM public.calls c
  WHERE c.id = _call_id AND c.nurse_id IS NULL
$$;

GRANT EXECUTE ON FUNCTION public.get_public_call(uuid) TO anon, authenticated;

-- 5. End / cancel that same call
CREATE OR REPLACE FUNCTION public.end_public_call(_call_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.calls
  SET status = 'ended', ended_at = now()
  WHERE id = _call_id AND nurse_id IS NULL AND status <> 'ended'
$$;

GRANT EXECUTE ON FUNCTION public.end_public_call(uuid) TO anon, authenticated;