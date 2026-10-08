/**
 * Protección contra envíos desde otros sitios (CSRF): el Origin del navegador debe ser el mismo
 * servidor que atiende la petición. Detrás de un proxy (Railway, HTTPS, red local) la URL interna
 * de Next no coincide con la pública, así que se compara con Host / X-Forwarded-Host.
 */
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  let host: string;
  try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
  const first = (v: string | null) => v?.split(',')[0]?.trim().toLowerCase() || null;
  const allowed = [first(request.headers.get('x-forwarded-host')), first(request.headers.get('host')), new URL(request.url).host.toLowerCase()];
  return allowed.includes(host);
}
