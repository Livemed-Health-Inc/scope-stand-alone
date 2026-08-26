-- ============================================================
-- HIPAA: audit logging, break-glass access, append-only trail
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_user_id UUID,
  actor_email TEXT,
  actor_kind TEXT NOT NULL DEFAULT 'user',
  device_id UUID,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  phi_accessed BOOLEAN NOT NULL DEFAULT false,
  outcome TEXT NOT NULL DEFAULT 'success',
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx ON public.audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON public.audit_log (actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log (entity, entity_id);

-- Append-only: no UPDATE/DELETE for anyone but the platform service role.
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.audit_log FROM authenticated, anon;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read the audit log" ON public.audit_log;
CREATE POLICY "Admins read the audit log"
ON public.audit_log FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'system_admin')
  OR public.has_role(auth.uid(), 'admin')
);

-- Hard block on mutation of history, even for a compromised admin session.
CREATE OR REPLACE FUNCTION public.audit_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_update ON public.audit_log;
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();

-- ------------------------------------------------------------
-- Central writer (security definer; the only way to append)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_audit_event(
  _action TEXT,
  _entity TEXT DEFAULT NULL,
  _entity_id TEXT DEFAULT NULL,
  _phi_accessed BOOLEAN DEFAULT false,
  _outcome TEXT DEFAULT 'success',
  _details JSONB DEFAULT '{}'::jsonb,
  _device_token TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
      AND d.active;
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

REVOKE ALL ON FUNCTION public.log_audit_event(TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, TEXT, BOOLEAN, TEXT, JSONB, TEXT) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Automatic change auditing on sensitive tables.
-- Records WHICH fields changed, never their values (minimum necessary).
-- ------------------------------------------------------------
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

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hospital_sites','devices','enrollment_codes','calls','user_roles',
    'role_permissions','doctor_assignments','admin_allowlist','tech_allowlist','profiles'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_%1$s ON public.%1$I', t);
      EXECUTE format(
        'CREATE TRIGGER audit_%1$s AFTER INSERT OR UPDATE OR DELETE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()',
        t
      );
    END IF;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- Break-glass emergency access
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.break_glass_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '60 minutes',
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS break_glass_user_idx ON public.break_glass_events (user_id, expires_at DESC);

GRANT SELECT ON public.break_glass_events TO authenticated;
GRANT ALL ON public.break_glass_events TO service_role;

ALTER TABLE public.break_glass_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins review break-glass" ON public.break_glass_events;
CREATE POLICY "Admins review break-glass"
ON public.break_glass_events FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.has_role(auth.uid(), 'super_admin')
  OR public.has_role(auth.uid(), 'system_admin')
  OR public.has_role(auth.uid(), 'admin')
);

CREATE OR REPLACE FUNCTION public.start_break_glass(_reason TEXT)
RETURNS public.break_glass_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _row public.break_glass_events;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 10 THEN
    RAISE EXCEPTION 'A written justification of at least 10 characters is required';
  END IF;

  INSERT INTO public.break_glass_events (user_id, reason)
  VALUES (_uid, btrim(_reason))
  RETURNING * INTO _row;

  PERFORM public.log_audit_event(
    'break_glass.start', 'break_glass_events', _row.id::text, true, 'success',
    jsonb_build_object('expires_at', _row.expires_at)
  );

  RETURN _row;
END;
$$;

REVOKE ALL ON FUNCTION public.start_break_glass(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_break_glass(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.break_glass_active(_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.break_glass_events
    WHERE user_id = _user_id AND ended_at IS NULL AND expires_at > now()
  );
$$;

REVOKE ALL ON FUNCTION public.break_glass_active(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.break_glass_active(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.end_break_glass()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.break_glass_events
  SET ended_at = now()
  WHERE user_id = auth.uid() AND ended_at IS NULL;
  PERFORM public.log_audit_event('break_glass.end', 'break_glass_events', NULL, true);
END;
$$;

REVOKE ALL ON FUNCTION public.end_break_glass() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_break_glass() TO authenticated, service_role;

-- ------------------------------------------------------------
-- Admin audit reader (bounded, filterable)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_trail(
  _since TIMESTAMPTZ DEFAULT now() - interval '7 days',
  _entity TEXT DEFAULT NULL,
  _actor TEXT DEFAULT NULL,
  _phi_only BOOLEAN DEFAULT false,
  _limit INT DEFAULT 200
)
RETURNS SETOF public.audit_log
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.audit_log
  WHERE (
      public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'system_admin')
      OR public.has_role(auth.uid(), 'admin')
    )
    AND occurred_at >= COALESCE(_since, now() - interval '7 days')
    AND (_entity IS NULL OR entity = _entity)
    AND (_actor IS NULL OR actor_email ILIKE '%' || _actor || '%')
    AND (NOT COALESCE(_phi_only, false) OR phi_accessed)
  ORDER BY occurred_at DESC
  LIMIT LEAST(COALESCE(_limit, 200), 1000);
$$;

REVOKE ALL ON FUNCTION public.audit_trail(TIMESTAMPTZ, TEXT, TEXT, BOOLEAN, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_trail(TIMESTAMPTZ, TEXT, TEXT, BOOLEAN, INT) TO authenticated, service_role;