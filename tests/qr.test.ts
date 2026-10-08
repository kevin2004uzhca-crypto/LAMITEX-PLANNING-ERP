import test from 'node:test';
import assert from 'node:assert/strict';
import { modulesFor, parseLabelCode } from '../src/lib/qr';

test('parseLabelCode normaliza lo que lee la cámara o escribe el operario', () => {
  assert.equal(parseLabelCode('LMX-0A1B2C3D4E5F'), 'LMX-0A1B2C3D4E5F');
  assert.equal(parseLabelCode(' lmx-0a1b2c3d4e5f '), 'LMX-0A1B2C3D4E5F');
  assert.equal(parseLabelCode('LMX0A1B2C3D4E5F'), 'LMX-0A1B2C3D4E5F');
  assert.equal(parseLabelCode('0a1b2c3d4e5f'), 'LMX-0A1B2C3D4E5F');
  assert.equal(parseLabelCode('https://x.test/q?c=LMX-0A1B2C3D4E5F'), 'LMX-0A1B2C3D4E5F');
  assert.equal(parseLabelCode('OTRA COSA'), 'OTRACOSA');
});

test('cada rol solo ve sus módulos', () => {
  assert.deepEqual(modulesFor('PACKER'), ['empaque']);
  assert.deepEqual(modulesFor('WAREHOUSE'), ['bodega']);
  assert.deepEqual(modulesFor('OFFICE'), ['produccion']);
  assert.deepEqual(modulesFor('ADMIN'), ['empaque', 'bodega', 'etiquetas', 'produccion']);
});

test('sameOrigin acepta el dominio público detrás de un proxy y rechaza otros sitios', async () => {
  const { sameOrigin } = await import('../src/lib/origin');
  const req = (origin: string | null, headers: Record<string, string> = {}) => new Request('http://localhost:8080/api/qr/scan', { method: 'POST', headers: { ...(origin ? { origin } : {}), ...headers } });
  assert.equal(sameOrigin(req('http://localhost:8080')), true);
  assert.equal(sameOrigin(req('https://lamitex.up.railway.app', { host: 'localhost:8080', 'x-forwarded-host': 'lamitex.up.railway.app' })), true);
  assert.equal(sameOrigin(req('http://192.168.1.20:3000', { host: '192.168.1.20:3000' })), true);
  assert.equal(sameOrigin(req('https://otro-sitio.com', { 'x-forwarded-host': 'lamitex.up.railway.app' })), false);
  assert.equal(sameOrigin(req(null)), false);
});
