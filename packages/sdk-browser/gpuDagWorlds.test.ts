// L'étirement objet → vue ne dépend que de la partie linéaire des matrices monde : un repère de
// rendu qui suit l'œil n'en déplace que les translations, et ne doit donc rien recalculer ni
// repousser. Oracle : le recalcul complet d'avant, `maxStretch` sur chaque matrice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { maxStretch } from '../sdk-core/index.ts';
import { FRAME_VEC4 } from './gpuDagTypes.ts';
import { refreshWorldStretch } from './gpuDagWorlds.ts';

const WORLDS = 4;

/** Quatre matrices monde d'échelles et de rotations distinctes, translations comprises. */
function scene() {
  const worlds = new Float32Array(WORLDS * 16);
  for (let w = 0; w < WORLDS; w++) {
    const base = w * 16,
      scale = 1 + w * 0.75;
    worlds[base] = scale;
    worlds[base + 5] = scale * 0.5;
    worlds[base + 10] = scale * 2;
    worlds[base + 15] = 1;
    worlds[base + 12] = w * 3;
    worlds[base + 13] = w * 5;
    worlds[base + 14] = w * 7;
  }
  return worlds;
}
/** L'oracle : l'étirement de chaque primitive, recalculé sans rien regarder de ce qui a bougé. */
const reference = (worlds: Float32Array) =>
  Float32Array.from({ length: WORLDS }, (_, w) => maxStretch(worlds.subarray(w * 16, w * 16 + 16)));

function packedOf() {
  return { worldCount: WORLDS, worldStretch: new Float32Array(WORLDS) };
}

test('une origine déplacée ne recalcule aucun étirement et ne repousse aucun cadre', () => {
  const previous = scene(),
    packed = packedOf(),
    frameData = new Float32Array(WORLDS * FRAME_VEC4 * 4);
  assert.equal(refreshWorldStretch(new Float32Array(WORLDS * 16), previous, packed, frameData), 4);
  const stretch = packed.worldStretch.slice(),
    frames = frameData.slice();
  // Le repère de rendu suit l'œil : seules les translations changent, d'une image à l'autre.
  const next = previous.slice();
  for (let w = 0; w < WORLDS; w++) {
    next[w * 16 + 12] += 1000;
    next[w * 16 + 13] -= 2000;
    next[w * 16 + 14] += 3;
  }
  assert.equal(refreshWorldStretch(previous, next, packed, frameData), 0);
  assert.deepEqual([...packed.worldStretch], [...stretch]);
  assert.deepEqual([...frameData], [...frames]);
  // Et ce que le recalcul complet aurait écrit est bien ce qui est déjà là.
  assert.deepEqual([...packed.worldStretch], [...reference(next)]);
});

test('une seule primitive redimensionnée est la seule recalculée, au flottant près', () => {
  const previous = scene(),
    packed = packedOf(),
    frameData = new Float32Array(WORLDS * FRAME_VEC4 * 4);
  refreshWorldStretch(new Float32Array(WORLDS * 16), previous, packed, frameData);
  const next = previous.slice();
  next[2 * 16 + 5] = 9.5;
  next[0 * 16 + 12] = 42;
  assert.equal(refreshWorldStretch(previous, next, packed, frameData), 1);
  assert.deepEqual([...packed.worldStretch], [...reference(next)]);
  assert.equal(frameData[(2 * FRAME_VEC4 + 6) * 4], reference(next)[2]);
});
