CREATE OR REPLACE FUNCTION public.claim_staff_role(_role text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN false; END IF;
  IF _role NOT IN ('doctor', 'nurse', 'hospital', 'patient') THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid) THEN RETURN false; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role::app_role);
  RETURN true;
END;
$$;