import { maxStretch } from '../sdk-core/index.ts';
import { FRAME_VEC4, type PackedDag } from './gpuDagTypes.ts';

/**
 * Indices of the linear part of a column-major world matrix, and the only indices `maxStretch`
 * reads (`projectionOracles.ts`). Translation — indices 12 to 14 — is not among them, nor is the
 * last row.
 */
const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10];

/**
 * Object-to-view stretch of primitives whose linear part moved, recomputed for them only; returns
 * their count.
 *
 * The render frame follows the eye: at each camera step, all sixteen floats of each world matrix
 * are rewritten while only their translation changes. Stretch depends only on the nine linear
 * coefficients — `maxStretch` reads only those — so a moved origin used to recompute it, yield
 * the exact same float, then push the whole frame buffer again. Zero returned here means "no
 * stretch changed": the buffer has nothing to receive.
 */
export function refreshWorldStretch(
  previous: Float32Array,
  next: Float32Array,
  packed: Pick<PackedDag, 'worldCount' | 'worldStretch'>,
  frameData: Float32Array,
) {
  let count = 0;
  for (let w = 0; w < packed.worldCount; w++) {
    const base = w * 16;
    let stretched = false;
    for (let k = 0; k < LINEAR.length; k++)
      if (previous[base + LINEAR[k]] !== next[base + LINEAR[k]]) {
        stretched = true;
        break;
      }
    if (!stretched) continue;
    count++;
    const stretch = maxStretch(next.subarray(base, base + 16));
    packed.worldStretch[w] = stretch;
    frameData[(w * FRAME_VEC4 + 6) * 4] = stretch;
  }
  return count;
}

/**
 * True where `next` differs from `previous` at any index: the scan `updateWorlds` runs before it
 * touches a buffer, so an image whose roots stand still uploads nothing. On a moving camera every
 * translation differs and the scan stops at the first root.
 */
export function worldsChanged(previous: Float32Array, next: Float32Array) {
  for (let j = 0; j < next.length; j++) if (previous[j] !== next[j]) return true;
  return false;
}
