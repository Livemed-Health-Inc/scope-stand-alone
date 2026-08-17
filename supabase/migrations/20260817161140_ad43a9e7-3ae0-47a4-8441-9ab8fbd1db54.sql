ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hospital';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'patient';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'tech';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'analytics';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'system_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';