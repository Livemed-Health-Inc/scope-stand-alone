INSERT INTO public.permissions (key, label, category, sort_order)
VALUES ('platform.note', 'Virtualis Note', 'Products', 45)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, category = EXCLUDED.category;

INSERT INTO public.role_permissions (role, permission_key)
VALUES ('doctor', 'platform.note'), ('super_admin', 'platform.note')
ON CONFLICT DO NOTHING;