import { distanceSqVector3 } from '../../../math/src/vector/vector.ts'
import { inverseAtRenderOrigin } from '../../../math/src/projection/renderOrigin.ts'
import type { ParticlePool } from '../../../sdk-core/src/fluids/particles.ts'
import { usedSlots } from './gpu/poolStates.ts'
import { ADD_ONE, OVER } from '../blend/equations.ts'

/** The words the particle draw gives a pool: clip matrix from its origin and inverse, made
 *  in double precision, eye from the origin, radius, colour at birth, softness; words 41–43 the
 *  image's exposure, display curve and unlit flag, 44–45 the size it draws, written by the draw;
 *  words 48–51 the view's clip plane from the pool's origin (`writeDrawWords`). */
export const DRAW_FLOATS = 52

/** Each blend's factors, one table for both draws: smoke covers colour and coverage alike, fire
 *  adds light and lays its coverage over the target's, so a fire over the background leaves its
 *  pixel covered (the composition, `composeAt`). */
export const BLENDS: Record<ParticlePool['blend'], GPUBlendState> = {
  additive: { color: ADD_ONE, alpha: OVER },
  premultiplied: { color: OVER, alpha: OVER },
}

type Vec = ArrayLike<number>
const NO_PLANE: Vec = [0, 0, 0, 0]
const [clip, unclip] = [new Float64Array(16), new Float64Array(16)]

/** Writes `pool`'s draw words into `out` from the image's world `viewProj` and `eye`, and the view's
 *  clip plane `plane` — `dot(xyz, p) + w` at least 0 drawn in the world, none for all zeros — moved
 *  to the pool's origin: its particles' positions are read from there. */
export function writeDrawWords(
  out: Float32Array,
  pool: ParticlePool,
  viewProj: Vec,
  eye: Vec,
  plane: Vec = NO_PLANE,
) {
  const o = pool.origin
  inverseAtRenderOrigin(unclip, clip, viewProj, o)
  out.set(clip, 0)
  out.set(unclip, 16)
  for (let i = 0; i < 3; i++) out[32 + i] = eye[i] - o[i]
  out[35] = pool.size
  out.set(pool.color, 36)
  out[40] = pool.softness
  for (let i = 0; i < 3; i++) out[48 + i] = plane[i]
  out[51] = plane[3] + plane[0] * o[0] + plane[1] * o[1] + plane[2] * o[2]
}

const keys: number[] = []

/** The pools with particles alive, in `into`, far to near from `eye` by origin: one emitter's
 *  smoke over the one behind it, nothing sorted within a pool, nothing allocated. */
export function drawOrder(pools: readonly ParticlePool[], eye: Vec, into: ParticlePool[]) {
  into.length = 0
  for (const pool of pools) {
    if (!pool.moving || !usedSlots(pool)) continue
    const key = distanceSqVector3(pool.origin, eye)
    let at = into.length
    for (; at > 0 && keys[at - 1] < key; at--) {
      into[at] = into[at - 1]
      keys[at] = keys[at - 1]
    }
    into[at] = pool
    keys[at] = key
  }
  return into
}
