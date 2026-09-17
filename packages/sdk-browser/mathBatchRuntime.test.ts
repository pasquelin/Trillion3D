// Les deux noyaux de calcul en lot (`mathBatchRuntime.ts`), chemin JavaScript contre chemin
// WebAssembly, sur de petits lots purement hostiles de `bench/m5Cas.mjs` (échelles négatives,
// cisaillement, `w` nul, NaN, ±0, infinis, 1e308, 5e-324) : mêmes bits des deux côtés, `Object.is`
// près — la même notion d'égalité que `bench/m5.bench.mjs` utilise pour la campagne complète, ici
// sur un lot assez petit pour tourner dans `pnpm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareSdkWasm } from './geometryPageWasm.ts';
import { prepareMathBatch } from './mathBatchState.ts';
import { createBoxTransformLot, createMultiplyLot } from './mathBatchRuntime.ts';
import { remplitBoites, remplitMatrices } from './bench/m5Cas.mjs';

// Petit lot : exactement 9 matrices hostiles × 7 boîtes hostiles, le produit croisé complet de
// `m5Cas.mjs` une fois chacun — pas un seul élément de pseudo-aléatoire ordinaire. Un lot plus court
// couperait avant les boîtes NaN et ±0 (les cinquième et sixième familles listées dans `BOITES`).
const N = 63;

await prepareSdkWasm(readFileSync(join(import.meta.dirname, 'pageCodec.wasm')));

/** La sortie du lot sur un chemin imposé, recopiée hors du tampon partagé. */
async function sortie<T extends { run(): 'js' | 'wasm'; out: Float64Array }>(
  lot: T,
  chemin: 'js' | 'wasm',
) {
  await prepareMathBatch(chemin);
  const joue = lot.run();
  assert.equal(joue, chemin, `chemin ${joue} joué alors que ${chemin} est imposé`);
  return lot.out.slice();
}

test('boxTransformBatch : mêmes bits en JavaScript et en WebAssembly sur des boîtes hostiles', async () => {
  const lot = await createBoxTransformLot(N);
  remplitBoites(lot, N);
  const parJs = await sortie(lot, 'js');
  const parWasm = await sortie(lot, 'wasm');
  assert.equal(lot.shared, true, 'le lot doit travailler dans la mémoire du module');
  assert.equal(parJs.length, parWasm.length);
  for (let i = 0; i < parJs.length; i++)
    assert.ok(
      Object.is(parJs[i], parWasm[i]),
      `boxTransformBatch[${i}] : ${parJs[i]} ≠ ${parWasm[i]}`,
    );
  lot.release();
});

test('boxTransformBatch : le départage ±0 de Math.min/Math.max se joue au même bit', async () => {
  // Aucune des neuf matrices hostiles de `m5Cas.mjs` ne porte de translation à `-0` : croisées avec
  // la boîte `[0, -0, 0, -0, 0, -0]`, leurs huit coins s'additionnent toujours à `+0` avant la
  // réduction — l'addition IEEE-754 d'un `+0` et d'un `-0` rend `+0`, quel que soit l'ordre. Ce cas
  // est construit à la main pour que le signe survive jusqu'à `js_min`/`js_max` : translation en x à
  // `-0`, coins tous à `x = ±0`. `Math.min` doit y rendre `-0`, `Math.max` `+0`, comme en JavaScript.
  const matriceTranslationMoinsZero = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0, 0, 0, 1];
  const boiteSigneeEnX = [0, -0, 0, -0, 0, -0];
  const lot = await createBoxTransformLot(1);
  lot.mats.set(matriceTranslationMoinsZero);
  lot.boxes.set(boiteSigneeEnX);
  const parJs = await sortie(lot, 'js');
  const parWasm = await sortie(lot, 'wasm');
  assert.ok(Object.is(parJs[0], -0), 'référence JS : Math.min doit départager vers -0');
  assert.ok(Object.is(parJs[3], 0) && !Object.is(parJs[3], -0), 'référence JS : Math.max vers +0');
  for (let i = 0; i < parJs.length; i++)
    assert.ok(
      Object.is(parJs[i], parWasm[i]),
      `boxTransformBatch[${i}] : ${parJs[i]} ≠ ${parWasm[i]}`,
    );
  lot.release();
});

test('multiplyMatrix4Batch : mêmes bits en JavaScript et en WebAssembly sur des matrices hostiles', async () => {
  const lot = await createMultiplyLot(N);
  remplitMatrices(lot, N);
  const parJs = await sortie(lot, 'js');
  const parWasm = await sortie(lot, 'wasm');
  assert.equal(lot.shared, true, 'le lot doit travailler dans la mémoire du module');
  assert.equal(parJs.length, parWasm.length);
  for (let i = 0; i < parJs.length; i++)
    assert.ok(
      Object.is(parJs[i], parWasm[i]),
      `multiplyMatrix4Batch[${i}] : ${parJs[i]} ≠ ${parWasm[i]}`,
    );
  lot.release();
});
