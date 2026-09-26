import { invertMatrix4 } from '../../../sdk-core/src/math/matrix/matrix4Inverse.ts';
import type { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts';
import { usedSlots } from './poolStates.ts';

/**
 * What the WebGPU and WebGL2 particle draws (#755) share: the words one pool is drawn with and
 * the order the pools are drawn in. The words are, in 32-bit floats: the clip matrix from the
 * pool's origin, its inverse (a pixel's depth back to a point from the origin, for the soft
 * edge), the eye from the origin then the particles' radius, the colour at birth, the softness.
 * Both matrices are made in double precision, so a pool ten kilometres out draws as sharply as
 * one at the world's origin.
 */
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

/**
 * The pools with particles alive, in `into`, far to near from `eye` by origin: the coarse sort
 * that lays one emitter's premultiplied smoke over the one behind it. Additive pools add in any
 * order; within a pool, nothing is sorted. Nothing is allocated.
 */
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
