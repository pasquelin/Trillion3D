import test from 'node:test';
import assert from 'node:assert/strict';
import { createGpuHiz } from './gpuHiz.ts';
import { hizBoundsWatcher, hizEncoder } from './gpuHizMockDevice.ts';

test('une boîte de test dont rien n’a bougé n’est ni réempaquetée ni renvoyée', async () => {
  const { device, writes } = hizBoundsWatcher(96);
  const hiz = await createGpuHiz(device, 33, 19, 3);
  assert.ok(hiz);
  const bounds = new Float64Array([0, 0, 32, 18, 0.8, 0, 0, 0, 16, 9, 0.5, 0, 0, 0, 8, 4, 0.25, 0]);
  const rows = new Uint32Array([1, 2, 3]);
  hiz.encodeTest(device, hizEncoder(), bounds, rows, 3, 4);
  hiz.encodeTest(device, hizEncoder(), bounds, rows, 3, 4);
  // La deuxième boîte seule change de borne : l'image n'envoie que ses trente-deux octets.
  bounds[10] = 0.75;
  hiz.encodeTest(device, hizEncoder(), bounds, rows, 3, 4);
  assert.deepEqual(
    writes.map(({ offset, length }) => [offset, length]),
    [
      [0, 96],
      [32, 32],
    ],
  );
  // Les octets renvoyés sont ceux qu'un empaquetage neuf de la même boîte écrirait.
  const fresh = hizBoundsWatcher(96);
  const neuf = await createGpuHiz(fresh.device, 33, 19, 3);
  assert.ok(neuf);
  neuf.encodeTest(fresh.device, hizEncoder(), bounds, rows, 3, 4);
  assert.deepEqual(
    [...new Uint32Array(writes[1].data)],
    [...new Uint32Array(fresh.writes[0].data.slice(32, 64))],
  );
  hiz.dispose();
  neuf.dispose();
});

test('un redimensionnement retire les octets tenus : la cible décide du rectangle', async () => {
  const { device, writes } = hizBoundsWatcher(64);
  const hiz = await createGpuHiz(device, 33, 19, 2);
  assert.ok(hiz);
  const bounds = new Float64Array([0, 0, 32, 18, 0.8, 0]),
    rows = new Uint32Array([1]);
  const encode = () => hiz.encodeTest(device, hizEncoder(), bounds, rows, 1, 2);
  encode();
  encode();
  assert.equal(writes.length, 1);
  assert.equal(hiz.resize(device, 65, 37), true);
  encode();
  assert.equal(writes.length, 2);
  hiz.dispose();
});
