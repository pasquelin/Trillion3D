// Entire hierarchy in batch (`mathBatchHierarchy.ts`), on hostile parent/child chains of
// foundation (`bench/socleHierarchie.mjs`: negative scales, zero, extreme, non-uniform under
// parent rotation, half-turns, positions at `-0`, depths 1 to 6, 5-child branches).
//
// Three sides, single truth: JavaScript path, WebAssembly path, and `three`, whose
// world matrices are calculated by fixture using `updateMatrixWorld(true)`. All three
// must yield identical bits down to `Object.is`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HIERARCHY_ROOT,
  MATRIX_VALUES,
  POSITION_VALUES,
  QUATERNION_VALUES,
} from '../sdk-core/index.ts';
import { prepareSdkWasm } from './geometryPageWasm.ts';
import { prepareMathBatch } from './mathBatchState.ts';
import { createHierarchyLot, type HierarchyLot } from './mathBatchHierarchy.ts';
import { chainesHostiles } from './bench/appui/socleHierarchie.mjs';

await prepareSdkWasm(readFileSync(join(import.meta.dirname, 'pageCodec.wasm')));

const noeuds = chainesHostiles() as {
  objet: { matrixWorld: { elements: number[] } };
  position: Float64Array;
  rotation: Float64Array;
  echelle: Float64Array;
  parent: number;
}[];

/** Local poses of nodes written into batch, in order of indices. */
function remplit(lot: HierarchyLot) {
  for (const [i, n] of noeuds.entries()) {
    lot.positions.set(n.position, i * POSITION_VALUES);
    lot.rotations.set(n.rotation, i * QUATERNION_VALUES);
    lot.scales.set(n.echelle, i * POSITION_VALUES);
    lot.parents[i] = n.parent < 0 ? HIERARCHY_ROOT : n.parent;
  }
}

/** World matrices returned by batch on forced path, copied outside shared buffer. */
async function sortie(lot: HierarchyLot, chemin: 'js' | 'wasm') {
  await prepareMathBatch(chemin);
  const joue = lot.run();
  assert.equal(joue, chemin, `path ${joue} played while ${chemin} is imposed`);
  return lot.world.slice();
}

test('hierarchyUpdateBatch: same bits in JavaScript, WebAssembly and `three`', async () => {
  const lot = await createHierarchyLot(noeuds.length);
  remplit(lot);
  const parJs = await sortie(lot, 'js');
  const parWasm = await sortie(lot, 'wasm');
  assert.equal(lot.shared, true, 'batch must work in module memory');
  assert.equal(parJs.length, noeuds.length * MATRIX_VALUES);
  for (const [i, n] of noeuds.entries()) {
    const reference = n.objet.matrixWorld.elements;
    for (let k = 0; k < MATRIX_VALUES; k++) {
      const at = i * MATRIX_VALUES + k;
      assert.ok(Object.is(parJs[at], parWasm[at]), `node ${i}, world[${k}]: js ≠ wasm`);
      assert.ok(Object.is(parJs[at], reference[k]), `node ${i}, world[${k}]: js ≠ three`);
    }
  }
  lot.release();
});

test('hierarchyUpdateBatch: batch views survive module memory growth', async () => {
  // Allocation external to batch — such as page decoding falling back to main thread —
  // detaches all views constructed prior to it. Batch must remain playable and return identical
  // bits as before, on the same bytes.
  const lot = await createHierarchyLot(noeuds.length);
  remplit(lot);
  const avant = await sortie(lot, 'wasm');
  const wasm = await prepareSdkWasm();
  assert.ok(wasm);
  const gros = wasm.arena_alloc(64 * 1024 * 1024);
  assert.ok(gros, 'large reservation must succeed');
  assert.equal(lot.holds(noeuds.length), true, 'batch still holds its nodes');
  const apres = await sortie(lot, 'wasm');
  for (let i = 0; i < avant.length; i++)
    assert.ok(Object.is(avant[i], apres[i]), `monde[${i}] : ${avant[i]} ≠ ${apres[i]}`);
  wasm.arena_free(gros, 64 * 1024 * 1024);
  lot.release();
  assert.equal(lot.holds(noeuds.length), false, 'a released batch holds nothing');
});
