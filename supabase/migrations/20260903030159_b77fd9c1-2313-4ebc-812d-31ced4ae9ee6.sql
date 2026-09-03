CREATE OR REPLACE FUNCTION public.audit_log_no_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only and cannot be truncated';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER audit_log_no_truncate
BEFORE TRUNCATE ON public.audit_log
FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_no_truncate();

COMMENT ON TABLE public.audit_log IS 'Append-only HIPAA audit trail. Rows cannot be updated, deleted, or truncated. Retention: 6 years minimum (45 CFR 164.316(b)(2)).';