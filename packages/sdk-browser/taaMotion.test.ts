import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_MATRIX4 } from '../sdk-core/index.ts';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { createPlacementMotion } from './taaMotion.ts';

/** Un appareil qui ne garde que les écritures : décalage en octets → flottants écrits. */
function recordingDevice() {
  const writes: Array<{ offset: number; data: number[] }> = [];
  const device = {
    createBuffer: ({ size }: { size: number }) => ({ size, destroy() {} }),
    queue: {
      writeBuffer(_b: unknown, offset: number, data: Float32Array, at = 0, count = data.length) {
        writes.push({ offset, data: [...data.subarray(at, at + count)] });
      },
    },
  } as unknown as GPUDevice;
  return { device, writes };
}

const IDENTITY = [...IDENTITY_MATRIX4];
const translation = (x: number, y: number, z: number) => ({
  world: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1] },
});

test('une racine immobile garde l’identité, une racine déplacée porte précédent·courant⁻¹, en une écriture', () => {
  installGpuGlobals();
  const { device, writes } = recordingDevice();
  const fixe = translation(1, 2, 3),
    mobile = translation(0, 0, 0);
  const motion = createPlacementMotion(device, [fixe, mobile]);
  // Une seule écriture à la création : tout le miroir, à l'identité.
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { offset: 0, data: [...IDENTITY, ...IDENTITY] });
  writes.length = 0;
  // Rien n'a bougé et la scène n'a pas changé : aucune comparaison, aucune écriture.
  motion.update([10, 20, 30], false);
  assert.equal(writes.length, 0);
  assert.equal(motion.moved, false);
  // La seconde racine avance de (4, 0, 0) : M ramène un point courant à sa place d'avant, soit
  // une translation de −4 — que l'ancrage sur l'œil ne change pas pour une translation pure. Une
  // écriture, sur la seule plage touchée.
  mobile.world.elements[12] = 4;
  motion.update([10, 20, 30], true);
  assert.deepEqual(writes, [
    { offset: 64, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -4, 0, 0, 1] },
  ]);
  assert.equal(motion.moved, true);
  writes.length = 0;
  // L'image d'après, sans nouveau mouvement : l'entrée revient à l'identité, et rien d'autre.
  motion.update([10, 20, 30], true);
  assert.deepEqual(writes, [{ offset: 64, data: IDENTITY }]);
  assert.equal(motion.moved, false);
});

test('une rotation déplacée s’ancre sur l’œil : la translation vaut R·œil + t − œil', () => {
  installGpuGlobals();
  const { device, writes } = recordingDevice();
  const racine = { world: { elements: [...IDENTITY] } };
  const motion = createPlacementMotion(device, [racine]);
  writes.length = 0;
  // Rotation d'un quart de tour autour de z : (x, y) → (−y, x). Son inverse tourne dans l'autre
  // sens, et « précédent » est l'identité, donc M = R⁻¹.
  racine.world.elements = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  motion.update([2, 0, 0], true);
  const m = writes[0].data;
  // R⁻¹ : (x, y) → (y, −x) ; colonne 0 = (0, −1, 0), colonne 1 = (1, 0, 0).
  assert.deepEqual(m.slice(0, 3), [0, -1, 0]);
  assert.deepEqual(m.slice(4, 7), [1, 0, 0]);
  // R⁻¹·œil − œil = (0, −2, 0) − (2, 0, 0) = (−2, −2, 0).
  assert.deepEqual(m.slice(12, 15), [-2, -2, 0]);
  assert.equal(m[15], 1);
  // L'historique perdu remet tout à l'identité et prend les poses courantes pour référence.
  writes.length = 0;
  motion.reset();
  assert.deepEqual(writes, [{ offset: 0, data: IDENTITY }]);
  writes.length = 0;
  motion.update([2, 0, 0], true);
  assert.equal(
    writes.length,
    0,
    'après la remise à zéro, la pose courante ne compte pas comme un mouvement',
  );
});
