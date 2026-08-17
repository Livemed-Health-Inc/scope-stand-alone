
INSERT INTO public.permissions (key, label, category, sort_order) VALUES
  ('platform.bedside', 'Bedside view', 'Products', 1),
  ('platform.telemedicine', 'Telemedicine platform (A/V + stethoscope + waiting room)', 'Products', 2),
  ('platform.chat', 'Virtualis Chat', 'Products', 3),
  ('platform.one', 'Virtualis One', 'Products', 4),
  ('patient.dtc', 'Direct-to-consumer visits', 'Products', 5),
  ('admin.org_users', 'Manage accounts in own hospital org', 'Administration', 115)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, category = EXCLUDED.category, sort_order = EXCLUDED.sort_order;

DELETE FROM public.role_permissions
WHERE role::text IN ('hospital','doctor','tech','patient','analytics','nurse','system_admin','super_admin');

INSERT INTO public.role_permissions (role, permission_key) VALUES
  ('hospital','platform.bedside'), ('hospital','nurse.station'), ('hospital','nurse.rounding'),

  ('doctor','platform.telemedicine'), ('doctor','platform.chat'), ('doctor','platform.one'),
  ('doctor','doctor.station'), ('doctor','doctor.consult'), ('doctor','nurse.rounding'),

  ('tech','tech.provision'), ('tech','platform.telemedicine'), ('tech','doctor.station'),
  ('tech','doctor.consult'), ('tech','platform.bedside'), ('tech','nurse.station'),

  ('patient','patient.dtc'), ('patient','patient.visit'), ('patient','doctor.consult'),

  ('analytics','analytics.view'),

  ('nurse','platform.chat'),

  ('system_admin','admin.org_users'), ('system_admin','admin.users'), ('system_admin','admin.hospitals'),
  ('system_admin','admin.techs'), ('system_admin','admin.physicians'), ('system_admin','analytics.view')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role, permission_key)
SELECT 'super_admin'::app_role, key FROM public.permissions
ON CONFLICT DO NOTHING;
