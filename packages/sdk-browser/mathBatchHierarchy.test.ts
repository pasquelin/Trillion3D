// La hiérarchie entière en lot (`mathBatchHierarchy.ts`), sur les chaînes parent/enfant hostiles du
// socle (`bench/socleHierarchie.mjs` : échelles négatives, nulle, extrêmes, non uniformes sous une
// rotation parente, demi-tours, positions à `-0`, profondeurs 1 à 6, branches à cinq enfants).
//
// Trois côtés, une seule vérité : le chemin JavaScript, le chemin WebAssembly, et `three`, dont les
// matrices monde sont celles que la fixture a fait calculer par `updateMatrixWorld(true)`. Les trois
// doivent rendre les mêmes bits, `Object.is` près.
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

/** Les poses locales des nœuds écrites dans le lot, dans l'ordre des indices. */
function remplit(lot: HierarchyLot) {
  for (const [i, n] of noeuds.entries()) {
    lot.positions.set(n.position, i * POSITION_VALUES);
    lot.rotations.set(n.rotation, i * QUATERNION_VALUES);
    lot.scales.set(n.echelle, i * POSITION_VALUES);
    lot.parents[i] = n.parent < 0 ? HIERARCHY_ROOT : n.parent;
  }
}

/** Les matrices monde que le lot rend sur un chemin imposé, recopiées hors du tampon partagé. */
async function sortie(lot: HierarchyLot, chemin: 'js' | 'wasm') {
  await prepareMathBatch(chemin);
  const joue = lot.run();
  assert.equal(joue, chemin, `chemin ${joue} joué alors que ${chemin} est imposé`);
  return lot.world.slice();
}

test('hierarchyUpdateBatch : mêmes bits en JavaScript, en WebAssembly et dans `three`', async () => {
  const lot = await createHierarchyLot(noeuds.length);
  remplit(lot);
  const parJs = await sortie(lot, 'js');
  const parWasm = await sortie(lot, 'wasm');
  assert.equal(lot.shared, true, 'le lot doit travailler dans la mémoire du module');
  assert.equal(parJs.length, noeuds.length * MATRIX_VALUES);
  for (const [i, n] of noeuds.entries()) {
    const reference = n.objet.matrixWorld.elements;
    for (let k = 0; k < MATRIX_VALUES; k++) {
      const at = i * MATRIX_VALUES + k;
      assert.ok(Object.is(parJs[at], parWasm[at]), `nœud ${i}, monde[${k}] : js ≠ wasm`);
      assert.ok(Object.is(parJs[at], reference[k]), `nœud ${i}, monde[${k}] : js ≠ three`);
    }
  }
  lot.release();
});

test('hierarchyUpdateBatch : les vues du lot survivent à une croissance de la mémoire du module', async () => {
  // Une allocation étrangère au lot — un décodage de page replié sur le fil principal en fait autant
  // — détache toutes les vues construites avant elle. Le lot doit rester jouable et rendre les mêmes
  // bits qu'avant, sur les mêmes octets.
  const lot = await createHierarchyLot(noeuds.length);
  remplit(lot);
  const avant = await sortie(lot, 'wasm');
  const wasm = await prepareSdkWasm();
  assert.ok(wasm);
  const gros = wasm.arena_alloc(64 * 1024 * 1024);
  assert.ok(gros, 'la grande réservation doit aboutir');
  assert.equal(lot.holds(noeuds.length), true, 'le lot porte toujours ses nœuds');
  const apres = await sortie(lot, 'wasm');
  for (let i = 0; i < avant.length; i++)
    assert.ok(Object.is(avant[i], apres[i]), `monde[${i}] : ${avant[i]} ≠ ${apres[i]}`);
  wasm.arena_free(gros, 64 * 1024 * 1024);
  lot.release();
  assert.equal(lot.holds(noeuds.length), false, 'un lot rendu ne porte plus rien');
});
