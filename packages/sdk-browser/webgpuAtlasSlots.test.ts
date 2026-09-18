import test from 'node:test';
import assert from 'node:assert/strict';
import { installGpuGlobals } from './webgpuPagesTestGlobals.ts';
import { createWebgpuAtlasSlots, type SlotPyramid } from './webgpuAtlasSlots.ts';

/** Capture chaque écriture de tampon, complète (l'amorçage) ou d'un seul mot (résidence). */
function fakeDevice() {
  const calls: Array<{ byteOffset: number; values: number[] }> = [];
  const device = {
    createBuffer: ({ size }: { size: number }) => ({ size, destroy() {} }),
    queue: {
      writeBuffer(
        _buffer: unknown,
        byteOffset: number,
        data: Uint32Array,
        dataOffset = 0,
        size = data.length,
      ) {
        calls.push({
          byteOffset,
          values: Array.from(data.subarray(dataOffset, dataOffset + size)),
        });
      },
    },
  } as unknown as GPUDevice;
  return { device, calls };
}

// Comportement 6 : le slot 0 (le remplissage de repli) est prêt dès la création, sans markReady.
test('le slot 0 est prêt dès la création, sans appel à markReady', () => {
  installGpuGlobals();
  const { device, calls } = fakeDevice();
  createWebgpuAtlasSlots(device, new Uint32Array(3), new Uint32Array(3));
  assert.equal(calls[0].values[1], 0xffffffff);
});

// Comportement 6 : la résidence n'avance que sur une suite de niveaux sans trou depuis le plus
// grossier — un niveau fin isolé n'écrit rien tant que les niveaux qui le séparent du sommet
// manquent, puis l'écriture reprend dès que le trou est comblé ; et quand la suite atteint le
// niveau 0, la couche est prête d'elle-même, sans `markReady`.
test('la résidence n’avance que sur une suite de niveaux sans trou depuis le plus grossier', () => {
  installGpuGlobals();
  const { device, calls } = fakeDevice();
  const slots = createWebgpuAtlasSlots(device, new Uint32Array(2), new Uint32Array(2));
  const pyramid: SlotPyramid = { first: 0, last: 2 };
  const before = calls.length;
  slots.markLevel('color', 1, 0, pyramid);
  assert.equal(calls.length, before, 'le niveau le plus fin seul ne comble aucun trou');
  slots.markLevel('color', 1, 2, pyramid);
  assert.deepEqual(calls.at(-1), { byteOffset: 12, values: [2 | (2 << 8)] });
  slots.markLevel('color', 1, 1, pyramid);
  assert.deepEqual(
    calls.at(-1),
    { byteOffset: 12, values: [0xffffffff] },
    'chaîne entière : prête',
  );
  slots.destroy();
});

// Comportement 6 : markReady est idempotent, ignore tout rang hors bornes ou non entier, et
// markLevel ignore de même un slot invalide.
test('markReady est idempotent et ignore les rangs invalides ; markLevel ignore un slot invalide', () => {
  installGpuGlobals();
  const { device, calls } = fakeDevice();
  const slots = createWebgpuAtlasSlots(device, new Uint32Array(3), new Uint32Array(3));
  const before = calls.length;
  slots.markReady('color', [1]);
  assert.deepEqual(calls.at(-1), { byteOffset: 12, values: [0xffffffff] });
  assert.equal(calls.length, before + 1);
  slots.markReady('color', [1]);
  assert.equal(calls.length, before + 1, 'un slot déjà prêt ne redéclenche pas d’écriture');
  slots.markReady('color', [0, -1, 999, 1.5]);
  assert.equal(calls.length, before + 1, 'rangs négatif, hors bornes et non entier tous ignorés');
  slots.markLevel('color', -1, 0, { first: 0, last: 0 });
  slots.markLevel('color', 999, 0, { first: 0, last: 0 });
  assert.equal(calls.length, before + 1, 'markLevel ignore aussi un slot invalide');
  slots.destroy();
});
