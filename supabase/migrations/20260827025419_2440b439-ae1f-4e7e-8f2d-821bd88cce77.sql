-- 1) Single sign-on hand-off codes for Virtualis Chat / Note
CREATE TABLE IF NOT EXISTS public.sso_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.sso_handoffs TO service_role;
ALTER TABLE public.sso_handoffs ENABLE ROW LEVEL SECURITY;
-- no policies: only server-side (service role) code may touch hand-off codes

-- 2) Scope the rounding queue to clinical staff instead of every logged-in account
DROP POLICY IF EXISTS "Staff view rounding queue" ON public.rounding_queue;
DROP POLICY IF EXISTS "Staff update rounding queue" ON public.rounding_queue;

CREATE POLICY "Rounding staff view queue"
ON public.rounding_queue FOR SELECT TO authenticated
USING (
  public.has_permission(auth.uid(), 'nurse.rounding')
  OR public.has_permission(auth.uid(), 'admin.hospitals')
  OR EXISTS (
    SELECT 1 FROM public.bedside_logins bl
    WHERE bl.user_id = auth.uid() AND bl.site_id = rounding_queue.site_id
  )
);

CREATE POLICY "Rounding staff update queue"
ON public.rounding_queue FOR UPDATE TO authenticated
USING (
  public.has_permission(auth.uid(), 'nurse.rounding')
  OR public.has_permission(auth.uid(), 'admin.hospitals')
  OR EXISTS (
    SELECT 1 FROM public.bedside_logins bl
    WHERE bl.user_id = auth.uid() AND bl.site_id = rounding_queue.site_id
  )
)
WITH CHECK (
  public.has_permission(auth.uid(), 'nurse.rounding')
  OR public.has_permission(auth.uid(), 'admin.hospitals')
  OR EXISTS (
    SELECT 1 FROM public.bedside_logins bl
    WHERE bl.user_id = auth.uid() AND bl.site_id = rounding_queue.site_id
  )
);