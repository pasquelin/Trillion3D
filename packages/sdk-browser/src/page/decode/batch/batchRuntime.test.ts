// Initial two batch computation kernels (`batchRuntime.ts`), JavaScript path vs
// WebAssembly path, on small purely hostile batches (negative scales,
// shear, zero `w`, NaN, ±0, infinities, 1e308, 5e-324): exact same bits on both sides down to
// `Object.is` — same notion of equality that `wasm-batches.perf.ts` uses for the full benchmark, here
// on a batch small enough to run in `pnpm test`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { prepareSdkWasm } from '../../../wasm/sdkWasm.ts'
import { prepareMathBatch } from './batchState.ts'
import { createBoxTransformLot, createMultiplyLot } from './batchRuntime.ts'
import { assertBits } from '../../../../../../tests/kit/assert/bits.ts'
import {
  fillsBoxes,
  remplitMatrices,
} from '../../../../../../bench/perf/browser/support/wasmBatchCases.ts'

// Small batch: exactly 9 hostile matrices × 7 hostile boxes, full Cartesian product of
// `wasmBatchCases.ts` once each — zero ordinary pseudo-random element. A shorter batch
// would cut before NaN and ±0 boxes (fifth and sixth families listed in `BOXES`).
const N = 63

await prepareSdkWasm(readFileSync(join(import.meta.dirname, '../../../wasm/kernels.wasm')))

/** Batch output on forced path, copied outside shared buffer. */
async function sortie<T extends { run(): 'js' | 'wasm'; out: Float64Array }>(
  lot: T,
  path: 'js' | 'wasm',
) {
  await prepareMathBatch(path)
  const played = lot.run()
  assert.equal(played, path, `path ${played} played while ${path} is imposed`)
  return lot.out.slice()
}

type Lot = { run(): 'js' | 'wasm'; out: Float64Array; shared: boolean; release(): void }

/** A filled batch played on both paths, in module memory, then released. */
async function assertSharedLotMatches(lot: Lot, kernel: string) {
  const parJs = await sortie(lot, 'js')
  const parWasm = await sortie(lot, 'wasm')
  assert.equal(lot.shared, true, 'batch must work in module memory')
  assert.equal(parJs.length, parWasm.length)
  assertBits(parWasm, parJs, kernel)
  lot.release()
}

test('boxTransformBatch: same bits in JavaScript and WebAssembly on hostile boxes', async () => {
  const lot = await createBoxTransformLot(N)
  fillsBoxes(lot, N)
  await assertSharedLotMatches(lot, 'boxTransformBatch')
})

test('boxTransformBatch: ±0 resolution of Math.min/Math.max matches at bit level', async () => {
  // None of 9 hostile matrices in `wasmBatchCases.ts` has translation at `-0`: crossed with
  // box `[0, -0, 0, -0, 0, -0]`, their 8 corners always sum to `+0` before reduction —
  // IEEE-754 addition of `+0` and `-0` yields `+0` regardless of order. Handcrafted case so
  // sign survives to `js_min`/`js_max`: x translation at `-0`, corners all at `x = ±0`.
  // `Math.min` must yield `-0`, `Math.max` `+0`, matching JavaScript.
  const matriceTranslationMoinsZero = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0, 0, 0, 1]
  const signedBoxInX = [0, -0, 0, -0, 0, -0]
  const lot = await createBoxTransformLot(1)
  lot.mats.set(matriceTranslationMoinsZero)
  lot.boxes.set(signedBoxInX)
  const parJs = await sortie(lot, 'js')
  const parWasm = await sortie(lot, 'wasm')
  assert.ok(Object.is(parJs[0], -0), 'JS reference: Math.min must resolve to -0')
  assert.ok(Object.is(parJs[3], 0) && !Object.is(parJs[3], -0), 'JS reference: Math.max to +0')
  assertBits(parWasm, parJs, 'boxTransformBatch')
  lot.release()
})

test('multiplyMatrix4Batch: same bits in JavaScript and WebAssembly on hostile matrices', async () => {
  const lot = await createMultiplyLot(N)
  remplitMatrices(lot, N)
  await assertSharedLotMatches(lot, 'multiplyMatrix4Batch')
})
