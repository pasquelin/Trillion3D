import { invertMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4Inverse.ts';
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
  const [x, y, z] = pool.origin;
  for (let i = 0; i < 12; i++) clip[i] = viewProj[i];
  for (let r = 0; r < 4; r++)
    clip[12 + r] = viewProj[r] * x + viewProj[4 + r] * y + viewProj[8 + r] * z + viewProj[12 + r];
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

let from: ArrayLike<number> = [0, 0, 0];
const far = ({ origin }: ParticlePool) =>
  (origin[0] - from[0]) ** 2 + (origin[1] - from[1]) ** 2 + (origin[2] - from[2]) ** 2;
const farFirst = (a: ParticlePool, b: ParticlePool) => far(b) - far(a);

/** The pools with particles alive, in `into`, far to near from `eye` by origin: one emitter's
 *  smoke over the one behind it, nothing sorted within a pool, nothing allocated. */
export function drawOrder(
  pools: readonly ParticlePool[],
  eye: ArrayLike<number>,
  into: ParticlePool[],
) {
  into.length = 0;
  for (const pool of pools) if (pool.moving && usedSlots(pool)) into.push(pool);
  from = eye;
  return into.sort(farFirst);
}
