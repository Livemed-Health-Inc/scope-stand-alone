-- Restore role checks for signed-in users: RLS policies call has_role() as the
-- caller, so the authenticated role needs EXECUTE even though it is definer.
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

-- Audit writes with a bedside device token hash the token with pgcrypto's
-- digest(), which lives in the extensions schema.
ALTER FUNCTION public.log_audit_event(text, text, text, boolean, text, jsonb, text)
  SET search_path = public, extensions;