export function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Configuración de conexión incompleta. Contacta al administrador.');
  if (!url.startsWith('https://')) throw new Error('La conexión remota requiere HTTPS.');
  return { url, key };
}
