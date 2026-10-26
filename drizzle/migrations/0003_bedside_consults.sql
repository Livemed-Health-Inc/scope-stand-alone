CREATE TABLE public.bedside_consults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.devices(id),
  site_id uuid NOT NULL REFERENCES public.hospital_sites(id),
  nurse_id uuid REFERENCES public.unit_nurses(id),
  nurse_name text,
  patient_name text NOT NULL,
  mrn text,
  room text,
  acuity text NOT NULL,
  reason text NOT NULL,
  specialty text NOT NULL,
  specialties text[] NOT NULL DEFAULT '{}',
  physician_id uuid,
  physician_name text,
  physician_email text,
  status text NOT NULL DEFAULT 'sent',
  virtualis_thread_id text,
  delivery_error text,
  responded_at timestamptz,
  expires_at timestamptz NOT NULL,
  call_id uuid REFERENCES public.calls(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bedside_consults TO service_role;
ALTER TABLE public.bedside_consults ENABLE ROW LEVEL SECURITY;
CREATE INDEX bedside_consults_device ON public.bedside_consults(device_id, created_at DESC);
CREATE TRIGGER bedside_consults_updated BEFORE UPDATE ON public.bedside_consults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.bedside_consult_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consult_id uuid NOT NULL REFERENCES public.bedside_consults(id) ON DELETE CASCADE,
  sender text NOT NULL,
  sender_name text NOT NULL,
  body text NOT NULL,
  virtualis_message_id text UNIQUE,
  delivered boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bedside_consult_messages TO service_role;
ALTER TABLE public.bedside_consult_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX bedside_consult_messages_consult ON public.bedside_consult_messages(consult_id, created_at);