// The two batch kernels (`batchRuntime.ts`) against the single-element functions a caller takes
// when it holds no lot (`boxTransform`, `multiplyMatrix4`), on small purely hostile batches
// (negative scales, shear, zero `w`, NaN, ±0, infinities, 1e308, 5e-324): exact same bits down
// to `Object.is` — same notion of equality that `wasm-batches.perf.ts` uses for the full
// benchmark, here on a batch small enough to run in `pnpm test`.
import test from 'node:test'
import assert from 'node:assert/strict'
import '../../../wasm/sdkWasm.fixture.ts'
import { createBoxTransformLot, createMultiplyLot } from './batchRuntime.ts'
import { BOX_VALUES, MATRIX_VALUES, boxTransform } from '../../../../../sdk-core/src/index.ts'
import { multiplyMatrix4 } from '../../../../../math/src/matrix/matrix4.ts'
import { assertBits } from '../../../../../../tests/kit/assert/bits.ts'
import {
  fillsBoxes,
  remplitMatrices,
} from '../../../../../../bench/perf/browser/support/wasmBatchCases.ts'

// Small batch: exactly 9 hostile matrices × 7 hostile boxes, full Cartesian product of
// `wasmBatchCases.ts` once each — zero ordinary pseudo-random element. A shorter batch
// would cut before NaN and ±0 boxes (fifth and sixth families listed in `BOXES`).
const N = 63

/** Each box of `boxes` moved alone by its matrix of `mats`. */
function boxesAlone(boxes: Float64Array, mats: Float64Array, n: number) {
  const out = new Float64Array(n * BOX_VALUES)
  for (let i = 0; i < n; i++)
    boxTransform(
      out,
      i * BOX_VALUES,
      boxes,
      i * BOX_VALUES,
      mats.subarray(i * MATRIX_VALUES, (i + 1) * MATRIX_VALUES),
    )
  return out
}

/** Each product of `a` and `b` taken alone. */
function productsAlone(a: Float64Array, b: Float64Array, n: number) {
  const out = new Float64Array(n * MATRIX_VALUES)
  const at = (values: Float64Array, i: number) =>
    values.subarray(i * MATRIX_VALUES, (i + 1) * MATRIX_VALUES)
  for (let i = 0; i < n; i++) multiplyMatrix4(at(out, i), at(a, i), at(b, i))
  return out
}

test('box transform lot: the bits of boxTransform on hostile boxes', async () => {
  const lot = await createBoxTransformLot(N)
  assert.ok(lot)
  fillsBoxes(lot, N)
  const alone = boxesAlone(lot.boxes.slice(), lot.mats.slice(), N)
  lot.run()
  assertBits(lot.out, alone, 'boxTransformBatch')
  lot.release()
})

test('box transform lot: ±0 resolution of Math.min/Math.max matches at bit level', async () => {
  // None of 9 hostile matrices in `wasmBatchCases.ts` has translation at `-0`: crossed with
  // box `[0, -0, 0, -0, 0, -0]`, their 8 corners always sum to `+0` before reduction —
  // IEEE-754 addition of `+0` and `-0` yields `+0` regardless of order. Handcrafted case so
  // sign survives to `js_min`/`js_max`: x translation at `-0`, corners all at `x = ±0`.
  // `Math.min` must yield `-0`, `Math.max` `+0`, matching JavaScript.
  const matriceTranslationMoinsZero = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0, 0, 0, 1]
  const signedBoxInX = [0, -0, 0, -0, 0, -0]
  const lot = await createBoxTransformLot(1)
  assert.ok(lot)
  lot.mats.set(matriceTranslationMoinsZero)
  lot.boxes.set(signedBoxInX)
  const alone = boxesAlone(lot.boxes.slice(), lot.mats.slice(), 1)
  lot.run()
  assert.ok(Object.is(alone[0], -0), 'JS reference: Math.min must resolve to -0')
  assert.ok(Object.is(alone[3], 0) && !Object.is(alone[3], -0), 'JS reference: Math.max to +0')
  assertBits(lot.out, alone, 'boxTransformBatch')
  lot.release()
})

test('multiply lot: the bits of multiplyMatrix4 on hostile matrices', async () => {
  const lot = await createMultiplyLot(N)
  assert.ok(lot)
  remplitMatrices(lot, N)
  const alone = productsAlone(lot.a.slice(), lot.b.slice(), N)
  lot.run()
  assertBits(lot.out, alone, 'multiplyMatrix4Batch')
  lot.release()
})

test('a released lot holds nothing: its caller moves each element alone', async () => {
  const lot = await createBoxTransformLot(2)
  assert.ok(lot)
  assert.equal(lot.holds(2), true)
  lot.release()
  assert.equal(lot.holds(2), false)
})
