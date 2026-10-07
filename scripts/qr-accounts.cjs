// Crea (o reactiva) las 4 cuentas de los módulos de control QR y les asigna su módulo.
// Usa la clave privada del proyecto SOLO en esta ejecución local (la pide a la CLI de Supabase ya autenticada);
// no la guarda ni la expone al navegador. Las contraseñas se guardan en .erp/CUENTAS_CONTROL_QR.txt (no se sube a git).
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const env = parseEnv(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8'));
const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL;
const REF = fs.readFileSync(path.join(ROOT, 'supabase', '.temp', 'project-ref'), 'utf8').trim();

// erp: perfil del ERP de planificación. null = sin acceso al ERP (solo su módulo QR).
const ACCOUNTS = [
  { email: 'empaque@lamitex.local', name: 'Empacador', role: 'PACKER', erp: false },
  { email: 'bodega@lamitex.local', name: 'Bodega', role: 'WAREHOUSE', erp: false },
  { email: 'produccion@lamitex.local', name: 'Secretaria de producción', role: 'OFFICE', erp: false },
  { email: 'tutor@lamitex.local', name: 'Administrador / tutor', role: 'ADMIN', erp: true },
];

function serviceKey() {
  const r = spawnSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', REF, '-o', 'json'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('No se pudo leer la clave del proyecto. Ejecuta "npx supabase login" y vuelve a intentar.\n' + (r.stderr || ''));
  const keys = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')));
  const legacy = keys.find(k => k.name === 'service_role' && k.api_key);
  const secret = keys.find(k => (k.type === 'secret' || String(k.api_key).startsWith('sb_secret_')) && k.api_key);
  const k = legacy?.api_key ?? secret?.api_key;
  if (!k) throw new Error('El proyecto no tiene una clave privada disponible.');
  return { key: k, jwt: k.split('.').length === 3 };
}

const password = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return 'Lmx-' + Array.from(crypto.randomBytes(10), b => abc[b % abc.length]).join('');
};

async function main() {
  const { key, jwt } = serviceKey();
  const headers = { apikey: key, 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${key}` } : {}) };
  const call = async (method, p, body, extra = {}) => {
    const res = await fetch(URL_BASE + p, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  const existing = (await call('GET', '/auth/v1/admin/users?per_page=1000')).users ?? [];
  const out = [];
  for (const a of ACCOUNTS) {
    const pass = password();
    let user = existing.find(u => (u.email || '').toLowerCase() === a.email);
    if (user) user = await call('PUT', `/auth/v1/admin/users/${user.id}`, { password: pass, email_confirm: true, ban_duration: 'none' });
    else user = await call('POST', '/auth/v1/admin/users', { email: a.email, password: pass, email_confirm: true, user_metadata: { full_name: a.name } });
    await call('POST', '/rest/v1/lmx_qr_user_access?on_conflict=user_id', { user_id: user.id, module_role: a.role, display_name: a.name, active: true }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    // Sin acceso al ERP de planificación (costos, plan maestro, etc.); el tutor queda como VIEWER (solo lectura).
    await call('PATCH', `/rest/v1/user_profiles?user_id=eq.${user.id}`, { display_name: a.name, active: a.erp, role: 'VIEWER' }, { Prefer: 'return=minimal' });
    out.push({ ...a, pass });
    console.log(`  OK  ${a.email}  →  ${a.name}`);
  }
  const lines = ['LAMITEX · CUENTAS DE CONTROL DE COLCHONES (QR)', `Generado: ${new Date().toLocaleString('es-EC')}`, '', ...out.map(a => `${a.name.padEnd(26)} ${a.email.padEnd(28)} ${a.pass}`), '', 'Cambia estas contraseñas cuando el sistema pase a uso real.'];
  fs.mkdirSync(path.join(ROOT, '.erp'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, '.erp', 'CUENTAS_CONTROL_QR.txt'), lines.join('\r\n'), 'utf8');
  console.log('\n' + lines.join('\n') + '\n\nGuardado en .erp\\CUENTAS_CONTROL_QR.txt');
}
main().catch(e => { console.error('\n[ERROR] ' + e.message); process.exit(1); });
