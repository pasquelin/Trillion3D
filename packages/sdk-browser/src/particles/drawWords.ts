import { invertMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4Inverse.ts';
import { transformHomogeneousPoint } from '../../../sdk-core/src/math/primitives/vector.ts';
import type { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { usedSlots } from './poolStates.ts';

/** The words both particle draws (#755) give a pool: clip matrix from its origin and inverse, made
 *  in double precision, eye from the origin, radius, colour at birth, softness. */
export const DRAW_FLOATS = 44;

const clip = new Float64Array(16),
  unclip = new Float64Array(16);

/** Writes `pool`'s draw words into `out` from the image's world `viewProj` and `eye`. */
export function writeDrawWords(
  out: Float32Array,
  pool: ParticlePool,
  viewProj: ArrayLike<number>,
  eye: ArrayLike<number>,
) {
  const o = pool.origin,
    x = o[0],
    y = o[1],
    z = o[2];
  clip.set(viewProj);
  transformHomogeneousPoint(clip, viewProj, x, y, z, 12);
  invertMatrix4(unclip, clip);
  out.set(clip, 0);
  out.set(unclip, 16);
  out[32] = eye[0] - x;
  out[33] = eye[1] - y;
  out[34] = eye[2] - z;
  out[35] = pool.size;
  out.set(pool.color, 36);
  out[40] = pool.softness;
}

const keys: number[] = [];

/** The pools with particles alive, in `into`, far to near from `eye` by origin: one emitter's
 *  smoke over the one behind it, nothing sorted within a pool, nothing allocated. */
export function drawOrder(
  pools: readonly ParticlePool[],
  eye: ArrayLike<number>,
  into: ParticlePool[],
) {
  into.length = 0;
  for (const pool of pools) {
    if (!pool.moving || !usedSlots(pool)) continue;
    const o = pool.origin,
      key = (o[0] - eye[0]) ** 2 + (o[1] - eye[1]) ** 2 + (o[2] - eye[2]) ** 2;
    let at = into.length;
    for (; at > 0 && keys[at - 1] < key; at--) {
      into[at] = into[at - 1];
      keys[at] = keys[at - 1];
    }
    into[at] = pool;
    keys[at] = key;
  }
  return into;
}
