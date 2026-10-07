-- Control QR: permisos para el rol de servicio (scripts de administración de cuentas).
-- Aditivo: solo concede privilegios sobre las tablas lmx_qr_.
BEGIN;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lmx_qr_user_access, public.lmx_qr_batches, public.lmx_qr_batch_lines, public.lmx_qr_labels, public.lmx_qr_scans TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
COMMIT;
