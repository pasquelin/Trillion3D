// Performance bench: batched computation in WebAssembly (WASM against JavaScript).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mesure, rapport } from '../../sdk-core/bench/socle.ts';
import { prepareSdkWasm } from '../geometryPageWasm.ts';
import { prepareMathBatch, mathBatchMetrics } from '../mathBatchState.ts';
import { createBoxTransformLot, createMultiplyLot } from '../mathBatchRuntime.ts';
import { TAILLES, remplitBoites, remplitMatrices } from './appui/casLotsWasm.ts';

await prepareSdkWasm(readFileSync(join(import.meta.dirname, '..', 'pageCodec.wasm')));
await prepareMathBatch('auto');

const LOTS = [
  { operation: 'boxTransformBatch', cree: createBoxTransformLot, remplit: remplitBoites },
  { operation: 'multiplyMatrix4Batch', cree: createMultiplyLot, remplit: remplitMatrices },
];

const etat = mathBatchMetrics();
test('the WebAssembly module is loaded and its compute contract accepted', () =>
  assert.equal(etat.wasmAvailable, true, etat.unavailableReason ?? ''));

const resultats = [];
for (const { operation, cree, remplit } of LOTS) {
  const cas = [];
  for (const n of TAILLES) {
    const lot = await cree(n);
    remplit(lot, n);
    cas.push({
      name: `${n} elements`,
      input: lot,
      size: n,
    });
  }

  resultats.push(
    await mesure({
      name: `lots-wasm ${operation}`,
      fichier: 'packages/sdk-browser/mathBatchRuntime.ts',
      cas,
      calcul: async (lot) => {
        await prepareMathBatch('wasm');
        lot.run();
        return lot.out.slice(0, lot.out.length);
      },
      attendu: async (lot) => {
        await prepareMathBatch('js');
        lot.run();
        return lot.out.slice(0, lot.out.length);
      },
      options: { tours: 20, budgetMs: 1000 },
    }),
  );
}

rapport('lots-wasm', resultats, 'batched WebAssembly compute yields the same bits as JavaScript');
