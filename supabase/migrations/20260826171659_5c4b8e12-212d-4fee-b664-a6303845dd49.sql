CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _row JSONB;
  _changed TEXT[] := ARRAY[]::TEXT[];
  _key TEXT;
  _noise TEXT[] := ARRAY['last_seen','updated_at','last_heartbeat'];
BEGIN
  _row := to_jsonb(COALESCE(NEW, OLD));

  IF TG_OP = 'UPDATE' THEN
    FOR _key IN SELECT jsonb_object_keys(to_jsonb(NEW)) LOOP
      IF to_jsonb(NEW) -> _key IS DISTINCT FROM to_jsonb(OLD) -> _key THEN
        _changed := _changed || _key;
      END IF;
    END LOOP;

    IF array_length(_changed, 1) IS NULL THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    -- Presence/heartbeat churn is not a security-relevant change.
    IF NOT EXISTS (SELECT 1 FROM unnest(_changed) c WHERE NOT (c = ANY(_noise))) THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;

  INSERT INTO public.audit_log (
    actor_user_id, actor_kind, action, entity, entity_id, details
  ) VALUES (
    _uid,
    CASE WHEN _uid IS NOT NULL THEN 'user' ELSE 'system' END,
    lower(TG_OP),
    TG_TABLE_NAME,
    COALESCE(_row ->> 'id', _row ->> 'user_id', _row ->> 'email'),
    jsonb_build_object('changed_fields', to_jsonb(_changed))
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;