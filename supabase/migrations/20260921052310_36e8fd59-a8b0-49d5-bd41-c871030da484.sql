CREATE OR REPLACE FUNCTION public.log_audit_event(_action text, _entity text DEFAULT NULL, _entity_id text DEFAULT NULL, _phi_accessed boolean DEFAULT false, _outcome text DEFAULT 'success', _details jsonb DEFAULT '{}'::jsonb, _device_token text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _uid UUID := auth.uid();
  _email TEXT;
  _device UUID;
  _id BIGINT;
BEGIN
  IF _uid IS NOT NULL THEN
    SELECT u.email INTO _email FROM auth.users u WHERE u.id = _uid;
  END IF;

  IF _device_token IS NOT NULL THEN
    SELECT d.id INTO _device
    FROM public.devices d
    WHERE d.token_hash = encode(digest(_device_token, 'sha256'), 'hex')
      AND d.status = 'active';
  END IF;

  INSERT INTO public.audit_log (
    actor_user_id, actor_email, actor_kind, device_id,
    action, entity, entity_id, phi_accessed, outcome, details
  ) VALUES (
    _uid,
    _email,
    CASE WHEN _uid IS NOT NULL THEN 'user' WHEN _device IS NOT NULL THEN 'device' ELSE 'anonymous' END,
    _device,
    left(_action, 120),
    left(_entity, 120),
    left(_entity_id, 120),
    COALESCE(_phi_accessed, false),
    COALESCE(left(_outcome, 40), 'success'),
    COALESCE(_details, '{}'::jsonb)
  )
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.log_audit_event(text, text, text, boolean, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, text, boolean, text, jsonb, text) TO anon, authenticated, service_role;