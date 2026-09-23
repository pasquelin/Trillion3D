// Initial two batch computation kernels (`batchRuntime.ts`), JavaScript path vs
// WebAssembly path, on small purely hostile batches from `bench/casLotsWasm.ts` (negative scales,
// shear, zero `w`, NaN, ±0, infinities, 1e308, 5e-324): exact same bits on both sides down to
// `Object.is` — same notion of equality that `bench/m5.bench.ts` uses for full benchmark, here
// on a batch small enough to run in `pnpm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareSdkWasm } from '../page/decode/geometryPageWasm.ts';
import { prepareMathBatch } from './batchState.ts';
import { createBoxTransformLot, createMultiplyLot } from './batchRuntime.ts';
import {
  remplitBoites,
  remplitMatrices,
} from '../../../../bench/perf/browser/support/casLotsWasm.ts';

// Small batch: exactly 9 hostile matrices × 7 hostile boxes, full Cartesian product of
// `casLotsWasm.ts` once each — zero ordinary pseudo-random element. A shorter batch
// would cut before NaN and ±0 boxes (fifth and sixth families listed in `BOITES`).
const N = 63;

await prepareSdkWasm(readFileSync(join(import.meta.dirname, '../page/decode/pageCodec.wasm')));

/** Batch output on forced path, copied outside shared buffer. */
async function sortie<T extends { run(): 'js' | 'wasm'; out: Float64Array }>(
  lot: T,
  chemin: 'js' | 'wasm',
) {
  await prepareMathBatch(chemin);
  const joue = lot.run();
  assert.equal(joue, chemin, `path ${joue} played while ${chemin} is imposed`);
  return lot.out.slice();
}

test('boxTransformBatch: same bits in JavaScript and WebAssembly on hostile boxes', async () => {
  const lot = await createBoxTransformLot(N);
  remplitBoites(lot, N);
  const parJs = await sortie(lot, 'js');
  const parWasm = await sortie(lot, 'wasm');
  assert.equal(lot.shared, true, 'batch must work in module memory');
  assert.equal(parJs.length, parWasm.length);
  for (let i = 0; i < parJs.length; i++)
    assert.ok(
      Object.is(parJs[i], parWasm[i]),
      `boxTransformBatch[${i}] : ${parJs[i]} ≠ ${parWasm[i]}`,
    );
  lot.release();
});

test('boxTransformBatch: ±0 resolution of Math.min/Math.max matches at bit level', async () => {
  // None of 9 hostile matrices in `casLotsWasm.ts` has translation at `-0`: crossed with
  // box `[0, -0, 0, -0, 0, -0]`, their 8 corners always sum to `+0` before reduction —
  // IEEE-754 addition of `+0` and `-0` yields `+0` regardless of order. Handcrafted case so
  // sign survives to `js_min`/`js_max`: x translation at `-0`, corners all at `x = ±0`.
  // `Math.min` must yield `-0`, `Math.max` `+0`, matching JavaScript.
  const matriceTranslationMoinsZero = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0, 0, 0, 1];
  const boiteSigneeEnX = [0, -0, 0, -0, 0, -0];
  const lot = await createBoxTransformLot(1);
  lot.mats.set(matriceTranslationMoinsZero);
  lot.boxes.set(boiteSigneeEnX);
  const parJs = await sortie(lot, 'js');
  const parWasm = await sortie(lot, 'wasm');
  assert.ok(Object.is(parJs[0], -0), 'JS reference: Math.min must resolve to -0');
  assert.ok(Object.is(parJs[3], 0) && !Object.is(parJs[3], -0), 'JS reference: Math.max to +0');
  for (let i = 0; i < parJs.length; i++)
    assert.ok(
      Object.is(parJs[i], parWasm[i]),
      `boxTransformBatch[${i}] : ${parJs[i]} ≠ ${parWasm[i]}`,
    );
  lot.release();
});

test('multiplyMatrix4Batch: same bits in JavaScript and WebAssembly on hostile matrices', async () => {
  const lot = await createMultiplyLot(N);
  remplitMatrices(lot, N);
  const parJs = await sortie(lot, 'js');
  const parWasm = await sortie(lot, 'wasm');
  assert.equal(lot.shared, true, 'batch must work in module memory');
  assert.equal(parJs.length, parWasm.length);
  for (let i = 0; i < parJs.length; i++)
    assert.ok(
      Object.is(parJs[i], parWasm[i]),
      `multiplyMatrix4Batch[${i}] : ${parJs[i]} ≠ ${parWasm[i]}`,
    );
  lot.release();
});
