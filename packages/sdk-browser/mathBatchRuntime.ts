import {
  BOX_VALUES,
  MATRIX_VALUES,
  boxTransformBatch,
  multiplyMatrix4Batch,
} from '../sdk-core/index.ts';
import { f64, joue, taille, tampon, vuesF64, type MathLot } from './mathBatchLot.ts';

/**
 * Initial two batches: box transformation and 4×4 matrix product, both operations
 * whose engine cost is proportional to element count. `mathBatchLot.ts` holds buffer,
 * timed execution, and common shape.
 *
 * Buffers are exposed via ACCESSORS rather than fixed fields: each read re-queries views from
 * buffer, which rebuilds them if module memory grew in between. A caller thus always writes
 * to live bytes without needing to know that memory growth occurred.
 */

/** Names under which governor holds medians, and keys of published report. */
const BOX_TRANSFORM_BATCH = 'boxTransformBatch';
const MULTIPLY_MATRIX4_BATCH = 'multiplyMatrix4Batch';

export interface BoxTransformLot extends MathLot {
  /** `6 · n` numbers: input boxes, `minX, minY, minZ, maxX, maxY, maxZ` per element. */
  readonly boxes: Float64Array;
  /** `16 · n` numbers: column-major matrices. */
  readonly mats: Float64Array;
  /** `6 · n` numbers: transformed boxes. */
  readonly out: Float64Array;
}

export interface MultiplyLot extends MathLot {
  readonly a: Float64Array;
  readonly b: Float64Array;
  readonly out: Float64Array;
}

/** A batch of `n` boxes transformed by `n` matrices. */
export async function createBoxTransformLot(n: number): Promise<BoxTransformLot> {
  const { wasm, blocs, release } = await tampon([
    { type: 'f64', longueur: n * BOX_VALUES },
    { type: 'f64', longueur: n * MATRIX_VALUES, pas: MATRIX_VALUES },
    { type: 'f64', longueur: n * BOX_VALUES },
  ]);
  const [inputOffset, matrices, outputOffset] = blocs().map((bloc) => bloc.offset);
  const wasmRun = wasm
    ? () => wasm.math_box_transform_batch(outputOffset, inputOffset, matrices, n)
    : null;
  return {
    n,
    shared: wasm !== null,
    get boxes() {
      return f64(blocs()[0]);
    },
    get mats() {
      return f64(blocs()[1]);
    },
    get out() {
      return f64(blocs()[2]);
    },
    holds: (count) => count > 0 && taille(blocs(), 0) === count * BOX_VALUES,
    run: () => {
      const b = blocs();
      return joue(BOX_TRANSFORM_BATCH, n, wasmRun, () =>
        boxTransformBatch(f64(b[2]), f64(b[0]), vuesF64(b[1]), n),
      );
    },
    release,
  };
}

/** A batch of `n` products `out[i] = a[i] · b[i]`. */
export async function createMultiplyLot(n: number): Promise<MultiplyLot> {
  const demande = { type: 'f64', longueur: n * MATRIX_VALUES, pas: MATRIX_VALUES } as const;
  const { wasm, blocs, release } = await tampon([demande, demande, demande]);
  const [gauche, droite, outputOffset] = blocs().map((bloc) => bloc.offset);
  const wasmRun = wasm
    ? () => wasm.math_multiply_matrix4_batch(outputOffset, gauche, droite, n)
    : null;
  return {
    n,
    shared: wasm !== null,
    get a() {
      return f64(blocs()[0]);
    },
    get b() {
      return f64(blocs()[1]);
    },
    get out() {
      return f64(blocs()[2]);
    },
    holds: (count) => count > 0 && taille(blocs(), 0) === count * MATRIX_VALUES,
    run: () => {
      const b = blocs();
      return joue(MULTIPLY_MATRIX4_BATCH, n, wasmRun, () =>
        multiplyMatrix4Batch(vuesF64(b[2]), vuesF64(b[0]), vuesF64(b[1]), n),
      );
    },
    release,
  };
}
