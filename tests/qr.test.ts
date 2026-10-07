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
