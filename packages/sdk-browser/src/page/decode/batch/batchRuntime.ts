import { BOX_VALUES, MATRIX_VALUES } from '../../../../../sdk-core/src/index.ts'
import { f64, size, batchBuffer, type MathLot } from './batchLot.ts'
import type { SdkWasm } from '../../../wasm/sdkWasm.ts'
import { mathBatchModule } from './batchState.ts'

/**
 * Initial two batches: box transformation and 4×4 matrix product, both operations
 * whose engine cost is proportional to element count, each run by its WebAssembly kernel
 * (`packages/page-codec-wasm/src/wasm_math.rs`), the bits of `boxTransform` and `multiplyMatrix4`.
 * `batchLot.ts` holds buffer and common shape.
 *
 * Buffers are exposed via ACCESSORS rather than fixed fields: each read re-queries views from
 * buffer, which rebuilds them if module memory grew in between. A caller thus always writes
 * to live bytes without needing to know that memory growth occurred.
 */

/** A batch of boxes to move by matrices, with its buffers. */
export interface BoxTransformLot extends MathLot {
  /** `6 · n` numbers: input boxes, `minX, minY, minZ, maxX, maxY, maxZ` per element. */
  readonly boxes: Float64Array
  /** `16 · n` numbers: column-major matrices. */
  readonly mats: Float64Array
  /** `6 · n` numbers: transformed boxes. */
  readonly out: Float64Array
}

/** A batch of matrix products, with its buffers. */
export interface MultiplyLot extends MathLot {
  /** The left matrices. */
  readonly a: Float64Array
  /** The right matrices. */
  readonly b: Float64Array
  /** Where the products go. */
  readonly out: Float64Array
}

/** A batch of `n` elements over three `f64` blocks of `values` numbers an element, read through
 *  the views `names` (re-queried at each read); it holds `count` elements when its first block
 *  does, and `kernel` runs it on the blocks' offsets over its first `count` elements, never past
 *  `n`. Made at once, in the module arrived (`mathBatchModule`); `null` when it refuses its size. */
function threeBlockLot<K extends string>(
  n: number,
  values: readonly [number, number, number],
  names: readonly [K, K, K],
  kernel: (wasm: SdkWasm, offsets: readonly number[], count: number) => void,
) {
  const buffer = batchBuffer(values.map((v) => ({ type: 'f64', length: n * v }) as const))
  if (!buffer) return null
  const { wasm, blocks, release } = buffer
  const offsets = blocks().map((block) => block.offset)
  const lot = {
    n,
    holds: (count: number) => count > 0 && size(blocks(), 0) === count * values[0],
    run: (count = n) => kernel(wasm, offsets, Math.min(count, n)),
    release,
  }
  names.forEach((name, at) =>
    Object.defineProperty(lot, name, { get: () => f64(blocks()[at]), enumerable: true }),
  )
  return lot as MathLot & Readonly<Record<K, Float64Array>>
}

/** A batch of `n` boxes transformed by `n` matrices, made at once in the module arrived; `null`
 *  when it refuses its size. */
export const boxTransformLot = (n: number): BoxTransformLot | null =>
  threeBlockLot(
    n,
    [BOX_VALUES, MATRIX_VALUES, BOX_VALUES],
    ['boxes', 'mats', 'out'],
    (wasm, [boxes, mats, out], count) => wasm.math_box_transform_batch(out, boxes, mats, count),
  )

/** `boxTransformLot`, once the module has arrived. */
export async function createBoxTransformLot(n: number) {
  await mathBatchModule()
  return boxTransformLot(n)
}

/** A batch of `n` products `out[i] = a[i] · b[i]`, once the module has arrived; `null` when it
 *  refuses its size. */
export async function createMultiplyLot(n: number): Promise<MultiplyLot | null> {
  await mathBatchModule()
  return threeBlockLot(
    n,
    [MATRIX_VALUES, MATRIX_VALUES, MATRIX_VALUES],
    ['a', 'b', 'out'],
    (wasm, [a, b, out], count) => wasm.math_multiply_matrix4_batch(out, a, b, count),
  )
}
