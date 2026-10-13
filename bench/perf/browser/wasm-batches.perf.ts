// Performance bench: the batches' WebAssembly kernels, each checked against its oracle, each
// element alone by its single-element function, on the same inputs (`batchOracles.fixture.ts`).
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
  boxesByLoop,
  productsByLoop,
} from '../../../packages/sdk-browser/src/page/decode/batch/batchOracles.fixture.ts'
import { TAILLES, fillsBoxes, remplitMatrices } from './support/wasmBatchCases.ts'

/** The oracle's boxes for `lot`. */
const boxesOf = (lot: BoxTransformLot) => boxesByLoop(lot.boxes.slice(), lot.mats.slice(), lot.n)

/** The oracle's products for `lot`. */
const productsOf = (lot: MultiplyLot) => productsByLoop(lot.a.slice(), lot.b.slice(), lot.n)

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
  await benchLot('box transform', createBoxTransformLot, fillsBoxes, boxesOf),
  await benchLot('matrix product', createMultiplyLot, remplitMatrices, productsOf),
]

rapport('lots-wasm', results, 'batched WebAssembly compute yields the same bits as JavaScript')
