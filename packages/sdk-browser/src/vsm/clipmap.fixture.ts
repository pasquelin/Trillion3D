// The sun's clipmap tests' camera and light-space helpers.
import { VSM_SUN_FINEST_LEVEL, VSM_SUN_COARSEST_LEVEL } from './constants.ts'
import { createVsmClipmap, type VsmClipmap } from './clipmap.ts'
import { transformAffinePoint } from '../../../math/src/vector/vector.ts'
import { VsmCacheManager } from './cacheManager.ts'

export const SUN = { id: 'sun', direction: [0.3, -0.9, 0.2] }
/** A 90° perspective camera (x_clip = x_view); its kind is the camera's `perspective`. */
export const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.1, 0]
export const VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
export const LEVELS = VSM_SUN_COARSEST_LEVEL - VSM_SUN_FINEST_LEVEL + 1

export function frame(cache: VsmCacheManager, eye: number[], width = 1024) {
  return createVsmClipmap(
    cache,
    SUN,
    { view: VIEW, projection: PROJECTION, perspective: true, eye },
    { width, height: width },
    0,
  )
}
/** World metres → the clipmap's light space, centimetres. */
export const lightSpace = (clipmap: VsmClipmap, p: number[]) =>
  transformAffinePoint(
    new Float64Array(3),
    clipmap.lightViewRotation,
    p[0] * 100,
    p[1] * 100,
    p[2] * 100,
  )
/** The world direction (metres) of the light-space axis `axis`. */
export const lightAxis = (clipmap: VsmClipmap, axis: number) => {
  const m = clipmap.lightViewRotation
  return [m[axis], m[4 + axis], m[8 + axis]]
}
export const along = (eye: number[], dir: number[], metres: number) =>
  eye.map((v, k) => v + dir[k] * metres)
/** Three frames so the light's entry is cached: uncached, then the uncached → cached step. */
export function cachedClipmap(cache: VsmCacheManager, eye: number[]) {
  for (let n = 0; n < 2; n++) {
    cache.frameStamp = n
    frame(cache, eye).cacheEntry.markRendered(n)
  }
  cache.frameStamp = 2
}
