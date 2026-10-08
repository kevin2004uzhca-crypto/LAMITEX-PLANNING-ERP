import test from 'node:test';
import assert from 'node:assert/strict';
import { modulesFor, parseLabelCode, planCompliance, planFit } from '../src/lib/qr';

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

test('planFit clasifica cada empaque frente al programa del día', () => {
  assert.equal(planFit(100, 37, true), 'IN_PLAN');
  assert.equal(planFit(20, 20, true), 'IN_PLAN');
  assert.equal(planFit(20, 21, true), 'EXCESS');
  assert.equal(planFit(0, 1, true), 'OFF_PLAN');
  assert.equal(planFit(0, 1, false), 'NO_PLAN');
});

test('planCompliance solo suma lo programado; excedente y fuera de programa van aparte', () => {
  const c = planCompliance([{ planned: 100, done: 96 }, { planned: 80, done: 80 }, { planned: 20, done: 21 }, { planned: 0, done: 3 }]);
  assert.deepEqual(c, { planned: 200, counted: 196, excess: 1, offPlan: 3, pct: 98 });
  assert.equal(planCompliance([{ planned: 0, done: 5 }]).pct, null);
});
