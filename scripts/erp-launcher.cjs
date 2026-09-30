const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const { spawn, spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const RUN = path.join(ROOT, '.erp');
const STATE = path.join(RUN, 'server.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function readState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } }
function envConfig() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Se requiere Node.js 22 o superior. Instala una version LTS compatible.');
  for (const file of ['package.json', 'package-lock.json', '.env.local']) if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`Falta ${file}. Completa la configuracion inicial.`);
  const env = { ...parseEnv(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8')), ...process.env };
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) {
    if (!env[key] || /your-|placeholder|example/i.test(env[key])) throw new Error(`${key} no esta configurada. Revisa .env.local.`);
  }
  let remote;
  try { remote = new URL(env.NEXT_PUBLIC_SUPABASE_URL); } catch { throw new Error('NEXT_PUBLIC_SUPABASE_URL no es una URL valida.'); }
  if (remote.protocol !== 'https:') throw new Error('Supabase remoto debe utilizar HTTPS.');
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (key.startsWith('sb_secret_')) throw new Error('La clave configurada es privada. Utiliza una clave publica publishable.');
  if (key.split('.').length === 3) {
    let role; try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role; } catch { throw new Error('Clave publica invalida.'); }
    if (role !== 'anon') throw new Error('No se permite una clave privilegiada en variables publicas.');
  } else if (!key.startsWith('sb_publishable_')) throw new Error('La clave no tiene formato publishable valido.');
  const port = Number(env.ERP_PORT || env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ERP_PORT debe ser un entero entre 1024 y 65535.');
  return { env, port };
}
async function probe(port) {
  try { const r = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2500), cache: 'no-store' }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}
async function occupied(port) {
  return await new Promise(resolve => { const server = net.createServer(); server.once('error', () => resolve(true)); server.listen(port, 'localhost', () => server.close(() => resolve(false))); });
}
function openBrowser(port) {
  if (process.argv.includes('--no-browser')) return;
  // Port is validated numeric; no environment value is interpolated into shell code.
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process 'http://localhost:${port}'`], { windowsHide: true, stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`Servidor activo, pero no se pudo abrir el navegador. Abre http://localhost:${port}`);
}
function dependencies() {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lockHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex');
  const marker = path.join(RUN, 'dependencies.sha256');
  let valid = true;
  for (const [name, version] of Object.entries({ ...p.dependencies, ...p.devDependencies })) {
    try { const installed = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')); if (/^\d/.test(version) && installed.version !== version) valid = false; } catch { valid = false; }
  }
  const prior = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8') : null;
  if (!valid) {
    console.log('Preparando dependencias una sola vez (npm ci)...');
    const result = spawnSync('cmd.exe', ['/d', '/c', 'npm.cmd ci'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) throw new Error('Fallo npm ci. Revisa la conexion y los permisos; vuelve a iniciar.');
  } else console.log('Dependencias listas. No se requiere instalacion.');
  fs.writeFileSync(marker, lockHash);
}
async function checkRemote(env) {
  try {
    const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/,'')}/auth/v1/settings`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error('remote');
  } catch { throw new Error('Fallo conexion con Supabase. Comprueba Internet, URL y clave publica en .env.local.'); }
}
async function stop() {
  const state = readState();
  if (!state) { console.log('No hay una instancia iniciada por este launcher.'); return; }
  if (!/^[a-f0-9-]{36}$/.test(state.instance) || state.root !== ROOT) throw new Error('No se pudo identificar la instancia. No se detuvo ningun proceso.');
  const health = await probe(state.port);
  if (health && health.instance !== state.instance) throw new Error('El puerto pertenece a otra instancia. No se detuvo ningun proceso.');
  fs.writeFileSync(path.join(RUN, `stop-${state.instance}`), 'stop');
  for (let i = 0; i < 40; i++) { if (!readState() || readState().instance !== state.instance) { console.log('ERP detenido.'); return; } await sleep(500); }
  throw new Error('El supervisor no respondio. No se cerraron otros procesos. Revisa .erp/server.log.');
}
async function supervise() {
  const { env, port } = envConfig();
  const instance = process.env.ERP_INSTANCE_ID;
  if (!instance) throw new Error('Falta identidad del supervisor.');
  const child = spawn(process.execPath, [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', 'localhost', '--port', String(port)], { cwd: ROOT, env: { ...env, ERP_INSTANCE_ID: instance }, stdio: 'inherit', windowsHide: true });
  fs.writeFileSync(STATE, JSON.stringify({ instance, port, root: ROOT, supervisorPid: process.pid, childPid: child.pid, started: new Date().toISOString() }));
  const stopFile = path.join(RUN, `stop-${instance}`);
  let stopping = false;
  const timer = setInterval(() => {
    if (!fs.existsSync(stopFile) || stopping) return;
    stopping = true;
    // Only the still-running direct child of THIS supervisor is targeted.
    if (child.exitCode === null && child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }, 300);
  function cleanup(code) { clearInterval(timer); if (readState()?.instance === instance) fs.rmSync(STATE, { force: true }); fs.rmSync(stopFile, { force: true }); process.exit(code || 0); }
  child.once('error', () => cleanup(1)); child.once('exit', cleanup);
}
async function main() {
  fs.mkdirSync(RUN, { recursive: true });
  if (process.argv.includes('--supervise')) return supervise();
  if (process.argv.includes('--stop')) return stop();
  console.log('\nLAMITEX PLANNING ERP\n');
  const { port, env } = envConfig();
  await checkRemote(env);
  const lock = path.join(RUN, 'launch.lock');
  let locked = false;
  for (let i = 0; i < 180; i++) {
    try { fs.mkdirSync(lock); locked = true; break; } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - fs.statSync(lock).mtimeMs > 240000) { fs.rmdirSync(lock); continue; }
      await sleep(1000);
    }
  }
  if (!locked) throw new Error('Otro inicio sigue en curso. Espera unos segundos y vuelve a intentarlo.');
  const heartbeat = setInterval(() => { try { const now = new Date(); fs.utimesSync(lock, now, now); } catch {} }, 15000);
  try {
    const health = await probe(port);
    if (health?.app === 'lamitex-planning-erp' && health.status === 'ready') {
      const page = await fetch(`http://localhost:${port}/login`, { signal: AbortSignal.timeout(60000) });
      if (!page.ok) throw new Error('La instancia existente no puede cargar el acceso. Revisa .erp/server.log.');
      console.log(`SERVIDOR ACTIVO - http://localhost:${port} (instancia existente)`); openBrowser(port); return;
    }
    if (await occupied(port)) throw new Error(`Puerto ${port} ocupado por otro proceso o ERP aun iniciando. No se cerro ningun proceso. Espera o configura ERP_PORT en .env.local.`);
    dependencies();
    const instance = crypto.randomUUID();
    const log = fs.openSync(path.join(RUN, 'server.log'), 'a');
    const supervisor = spawn(process.execPath, [__filename, '--supervise'], { cwd: ROOT, env: { ...process.env, ERP_INSTANCE_ID: instance }, detached: true, stdio: ['ignore', log, log], windowsHide: true });
    supervisor.unref(); fs.closeSync(log);
    console.log(`Iniciando ERP en http://localhost:${port}. Esperando respuesta...`);
    for (let i = 0; i < 120; i++) {
      const ready = await probe(port);
      if (ready?.app === 'lamitex-planning-erp' && ready.instance === instance) {
        const login = await fetch(`http://localhost:${port}/login`, { signal: AbortSignal.timeout(60000) });
        if (!login.ok) throw new Error('La pantalla de acceso no responde correctamente. Revisa .erp/server.log.');
        console.log(`\nSERVIDOR ACTIVO - http://localhost:${port}\nPara detenerlo: doble clic en DETENER_ERP.cmd`);
        openBrowser(port); return;
      }
      await sleep(1000);
    }
    throw new Error('Next.js no respondio dentro del tiempo esperado. Revisa .erp/server.log; utiliza DETENER_ERP.cmd antes de reintentar.');
  } finally { clearInterval(heartbeat); fs.rmdirSync(lock); }
}
main().catch(error => { console.error(`[ERROR] ${error.message}`); process.exitCode = 1; });
