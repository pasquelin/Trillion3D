// Banc du lot M5 « calcul en lot en WebAssembly », en deux parties dans un même script.
//
// 1. Équivalence : sur chaque taille de lot, le chemin WebAssembly contre le chemin JavaScript de
//    référence, sur les cas hostiles de `m5Cas.mjs` — échelles négatives, cisaillement, division
//    homogène par un `w` nul, NaN, zéros signés, infinis. Un seul bit d'écart fait échouer le
//    script ; `Object.is` sépare `-0` de `+0` et voit les NaN, ce qui est la bonne notion d'égalité
//    pour des flottants relus dans un `Float64Array`.
// 2. Performance : ns par élément des deux chemins, dans un processus neuf lancé par ce script.
//
// `M5_COURT=1` ne fait que vérifier que le script tourne. La campagne officielle se lance sans lui,
// machine calme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rejoueEnProcessusNeuf } from '../../sdk-core/bench/bancProcessusNeuf.mjs';
import { prepareSdkWasm } from '../geometryPageWasm.ts';
import { prepareMathBatch, mathBatchMetrics } from '../mathBatchState.ts';
import { createBoxTransformLot, createMultiplyLot } from '../mathBatchRuntime.ts';
import { TAILLES, remplitBoites, remplitMatrices } from './m5Cas.mjs';

// Node ne sait pas suivre une URL de fichier avec `fetch` : les octets du module sont fournis à la
// main, et la mémorisation du chargeur fait que tout le reste du banc les retrouve.
await prepareSdkWasm(readFileSync(join(import.meta.dirname, '..', 'pageCodec.wasm')));
await prepareMathBatch('auto');

const LOTS = [
  { operation: 'boxTransformBatch', cree: createBoxTransformLot, remplit: remplitBoites },
  { operation: 'multiplyMatrix4Batch', cree: createMultiplyLot, remplit: remplitMatrices },
];

if (process.env.M5_PARTIE === 'performance') {
  const { mesurePerformance } = await import('./m5Perf.mjs');
  await mesurePerformance(LOTS);
} else {
  const etat = mathBatchMetrics();
  test('le module WebAssembly est chargé et son contrat de calcul accepté', () =>
    assert.equal(etat.wasmAvailable, true, etat.unavailableReason ?? ''));

  /** Le lot joué sur un chemin imposé, et sa sortie recopiée hors du tampon partagé. */
  async function sortie(lot, n, chemin) {
    await prepareMathBatch(chemin);
    const joue = lot.run();
    assert.equal(joue, chemin, `chemin ${joue} joué alors que ${chemin} est imposé`);
    return lot.out.slice(0, lot.out.length);
  }

  for (const { operation, cree, remplit } of LOTS)
    for (const n of TAILLES) {
      const lot = await cree(n);
      remplit(lot, n);
      const parJs = await sortie(lot, n, 'js');
      const parWasm = await sortie(lot, n, 'wasm');
      test(`${operation} · ${n} éléments · mêmes bits des deux côtés`, () => {
        assert.equal(lot.shared, true, 'le lot doit travailler dans la mémoire du module');
        assert.equal(parJs.length, parWasm.length);
        for (let i = 0; i < parJs.length; i++)
          assert.ok(
            Object.is(parJs[i], parWasm[i]),
            `${operation}[${i}] : ${parJs[i]} ≠ ${parWasm[i]}`,
          );
      });
      lot.release();
    }

  rejoueEnProcessusNeuf(import.meta.url, 'M5_PARTIE');
}
