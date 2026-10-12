import { BOX_VALUES, MATRIX_VALUES } from '../../../../../sdk-core/src/index.ts'
import { f64, size, batchBuffer, type MathLot } from './batchLot.ts'

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

/** A batch of `n` boxes transformed by `n` matrices; `null` when the module refuses its size. */
export async function createBoxTransformLot(n: number): Promise<BoxTransformLot | null> {
  const buffer = await batchBuffer([
    { type: 'f64', length: n * BOX_VALUES },
    { type: 'f64', length: n * MATRIX_VALUES },
    { type: 'f64', length: n * BOX_VALUES },
  ])
  if (!buffer) return null
  const { wasm, blocks, release } = buffer
  const [inputOffset, matrices, outputOffset] = blocks().map((block) => block.offset)
  return {
    n,
    get boxes() {
      return f64(blocks()[0])
    },
    get mats() {
      return f64(blocks()[1])
    },
    get out() {
      return f64(blocks()[2])
    },
    holds: (count) => count > 0 && size(blocks(), 0) === count * BOX_VALUES,
    run: () => wasm.math_box_transform_batch(outputOffset, inputOffset, matrices, n),
    release,
  }
}

/** A batch of `n` products `out[i] = a[i] · b[i]`; `null` when the module refuses its size. */
export async function createMultiplyLot(n: number): Promise<MultiplyLot | null> {
  const request = { type: 'f64', length: n * MATRIX_VALUES } as const
  const buffer = await batchBuffer([request, request, request])
  if (!buffer) return null
  const { wasm, blocks, release } = buffer
  const [left, right, outputOffset] = blocks().map((block) => block.offset)
  return {
    n,
    get a() {
      return f64(blocks()[0])
    },
    get b() {
      return f64(blocks()[1])
    },
    get out() {
      return f64(blocks()[2])
    },
    holds: (count) => count > 0 && size(blocks(), 0) === count * MATRIX_VALUES,
    run: () => wasm.math_multiply_matrix4_batch(outputOffset, left, right, n),
    release,
  }
}
