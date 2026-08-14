CREATE TYPE public.app_role AS ENUM ('doctor', 'nurse');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  specialty TEXT,
  hospital TEXT NOT NULL DEFAULT 'Virtualis General Hospital',
  unit TEXT NOT NULL DEFAULT 'ICU - 4 West',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT, INSERT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view roles" ON public.user_roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users claim own role" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.doctor_presence (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_online BOOLEAN NOT NULL DEFAULT false,
  in_consult BOOLEAN NOT NULL DEFAULT false,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_presence TO authenticated;
GRANT ALL ON public.doctor_presence TO service_role;
ALTER TABLE public.doctor_presence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff can view presence" ON public.doctor_presence FOR SELECT TO authenticated USING (true);
CREATE POLICY "Doctors insert own presence" ON public.doctor_presence FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Doctors update own presence" ON public.doctor_presence FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nurse_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','accepted','declined','ended','missed')),
  patient_room TEXT,
  reason TEXT,
  hospital TEXT,
  unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.calls TO authenticated;
GRANT ALL ON public.calls TO service_role;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Participants view calls" ON public.calls FOR SELECT TO authenticated USING (auth.uid() = nurse_id OR auth.uid() = doctor_id);
CREATE POLICY "Nurses create calls" ON public.calls FOR INSERT TO authenticated WITH CHECK (auth.uid() = nurse_id AND public.has_role(auth.uid(), 'nurse'));
CREATE POLICY "Participants update calls" ON public.calls FOR UPDATE TO authenticated USING (auth.uid() = nurse_id OR auth.uid() = doctor_id) WITH CHECK (auth.uid() = nurse_id OR auth.uid() = doctor_id);

CREATE INDEX calls_doctor_status_idx ON public.calls (doctor_id, status);
CREATE INDEX calls_nurse_idx ON public.calls (nurse_id, created_at DESC);

ALTER TABLE public.doctor_presence REPLICA IDENTITY FULL;
ALTER TABLE public.calls REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.doctor_presence;
ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;