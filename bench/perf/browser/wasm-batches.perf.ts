// Performance bench: the batches' WebAssembly kernels, each checked against the JavaScript loop
// of the maths package on the same inputs.
import { measure, rapport } from '../../core/index.ts'
import type { MeasureCase } from '../../core/index.ts'
import '../../../packages/sdk-browser/src/wasm/sdkWasm.fixture.ts'
import {
  createBoxTransformLot,
  createMultiplyLot,
  type BoxTransformLot,
  type MultiplyLot,
} from '../../../packages/sdk-browser/src/page/decode/batch/batchRuntime.ts'
import type { MathLot } from '../../../packages/sdk-browser/src/page/decode/batch/batchLot.ts'
import {
  MATRIX_VALUES,
  boxTransformBatch,
  multiplyMatrix4Batch,
} from '../../../packages/math/src/index.ts'
import { TAILLES, fillsBoxes, remplitMatrices } from './support/wasmBatchCases.ts'

/** `n` sub-views of sixteen numbers over a copy of `values`: the JavaScript loop's matrices. */
function matrices(values: Float64Array, n: number) {
  const copy = values.slice()
  return Array.from({ length: n }, (_, i) =>
    copy.subarray(i * MATRIX_VALUES, (i + 1) * MATRIX_VALUES),
  )
}

/** The JavaScript loop's boxes for `lot`. */
function boxesByLoop(lot: BoxTransformLot) {
  const out = new Float64Array(lot.out.length)
  boxTransformBatch(out, lot.boxes.slice(), matrices(lot.mats, lot.n), lot.n)
  return out
}

/** The JavaScript loop's products for `lot`. */
function productsByLoop(lot: MultiplyLot) {
  const out = new Float64Array(lot.out.length)
  const views = Array.from({ length: lot.n }, (_, i) =>
    out.subarray(i * MATRIX_VALUES, (i + 1) * MATRIX_VALUES),
  )
  multiplyMatrix4Batch(views, matrices(lot.a, lot.n), matrices(lot.b, lot.n), lot.n)
  return out
}

// Each lot keeps its own buffer type end to end: `cree` and `remplit` are called together,
// never mixed across the two operations, so the pair stays type-correlated per call.
async function benchLot<T extends MathLot & { readonly out: Float64Array }>(
  operation: string,
  cree: (n: number) => Promise<T | null>,
  remplit: (lot: T, n: number) => void,
  byLoop: (lot: T) => Float64Array,
) {
  const cas: MeasureCase<T>[] = []
  for (const n of TAILLES) {
    const lot = await cree(n)
    if (!lot) throw new Error(`the module refused a lot of ${n} elements`)
    remplit(lot, n)
    cas.push({ name: `${n} elements`, input: lot, size: n })
  }
  return measure({
    name: `lots-wasm ${operation}`,
    fichier: 'packages/sdk-browser/src/page/decode/batch/batchRuntime.ts',
    cas,
    calculation: (lot) => {
      lot.run()
      return lot.out.slice(0, lot.out.length)
    },
    expected: byLoop,
    options: { tours: 20, budgetMs: 1000 },
  })
}

const results = [
  await benchLot('boxTransformBatch', createBoxTransformLot, fillsBoxes, boxesByLoop),
  await benchLot('multiplyMatrix4Batch', createMultiplyLot, remplitMatrices, productsByLoop),
]

rapport('lots-wasm', results, 'batched WebAssembly compute yields the same bits as JavaScript')
