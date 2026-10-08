-- ============================================================
-- LAMITEX · CUENTAS NUEVAS INACTIVAS POR DEFECTO
-- Antes, toda cuenta nueva de Supabase Auth recibía un perfil ERP activo (rol VIEWER)
-- y podía leer el ERP. Ahora el perfil nuevo nace inactivo hasta que un ADMIN lo active.
--
-- No modifica ningún perfil existente ni ningún dato: solo cambia el valor por defecto
-- de la columna para las filas que se creen de aquí en adelante.
-- Las cuentas del Control QR (scripts/qr-accounts.cjs) fijan "active" explícitamente.
-- ============================================================
BEGIN;
ALTER TABLE public.user_profiles ALTER COLUMN active SET DEFAULT false;
COMMENT ON COLUMN public.user_profiles.active IS 'Acceso al ERP. Las cuentas nuevas nacen inactivas; un ADMIN las activa.';
COMMIT;
