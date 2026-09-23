// Performance bench: batched computation in WebAssembly (WASM against JavaScript).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mesure, rapport } from '../../core/index.ts';
import type { MesureCas } from '../../core/index.ts';
import { prepareSdkWasm } from '../../../packages/sdk-browser/geometryPageWasm.ts';
import {
  prepareMathBatch,
  mathBatchMetrics,
} from '../../../packages/sdk-browser/mathBatchState.ts';
import {
  createBoxTransformLot,
  createMultiplyLot,
} from '../../../packages/sdk-browser/mathBatchRuntime.ts';
import type { MathLot } from '../../../packages/sdk-browser/mathBatchLot.ts';
import { TAILLES, remplitBoites, remplitMatrices } from './support/casLotsWasm.ts';

await prepareSdkWasm(
  readFileSync(join(import.meta.dirname, '../../../packages/sdk-browser/pageCodec.wasm')),
);
await prepareMathBatch('auto');

const etat = mathBatchMetrics();
test('the WebAssembly module is loaded and its compute contract accepted', () =>
  assert.equal(etat.wasmAvailable, true, etat.unavailableReason ?? ''));

// Each lot keeps its own buffer type end to end: `cree` and `remplit` are called together,
// never mixed across the two operations, so the pair stays type-correlated per call.
async function benchLot<T extends MathLot & { readonly out: Float64Array }>(
  operation: string,
  cree: (n: number) => Promise<T>,
  remplit: (lot: T, n: number) => void,
) {
  const cas: MesureCas<T>[] = [];
  for (const n of TAILLES) {
    const lot = await cree(n);
    remplit(lot, n);
    cas.push({ name: `${n} elements`, input: lot, size: n });
  }
  return mesure({
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
  });
}

const resultats = [
  await benchLot('boxTransformBatch', createBoxTransformLot, remplitBoites),
  await benchLot('multiplyMatrix4Batch', createMultiplyLot, remplitMatrices),
];

rapport('lots-wasm', resultats, 'batched WebAssembly compute yields the same bits as JavaScript');
