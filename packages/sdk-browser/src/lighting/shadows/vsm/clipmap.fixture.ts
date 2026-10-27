// The sun's clipmap tests' camera and light-space helpers.
import { createVsmClipmap, type VsmClipmap } from './clipmap.ts'
import { VSM_DEFAULT_SHADOWS, vsmSunLevels, type VsmMapSettings } from './mapSettings.ts'
import { transformAffinePoint } from '../../../../../math/src/vector/vector.ts'
import { VsmCacheManager } from './cacheManager.ts'

export const SUN = { id: 'sun', direction: [0.3, -0.9, 0.2] }
/** A 90° perspective camera (x_clip = x_view); its kind is the camera's `perspective`. */
export const PROJECTION = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -0.1, 0]
export const VIEW = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
export const LEVELS = vsmSunLevels(VSM_DEFAULT_SHADOWS)

/** The settings `changes` write over the defaults, at scene frame `frame`. */
export const mapsOf = (changes: Partial<typeof VSM_DEFAULT_SHADOWS>, frame = 0) =>
  ({ shadows: { ...VSM_DEFAULT_SHADOWS, ...changes }, frame }) as VsmMapSettings

export function frame(cache: VsmCacheManager, eye: number[], width = 1024, maps?: VsmMapSettings) {
  return createVsmClipmap(
    cache,
    SUN,
    { view: VIEW, projection: PROJECTION, perspective: true, eye },
    { width, height: width },
    maps,
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
/** `frames` frames of a sun under `maps`, each marked rendered, the last clipmap returned. */
export function renderedFrames(
  cache: VsmCacheManager,
  frames: number,
  maps?: ReturnType<typeof mapsOf>,
) {
  let clipmap!: VsmClipmap
  for (let n = 0; n < frames; n++) {
    cache.frameStamp = n
    clipmap = frame(cache, [0, 0, 0], 1024, maps)
    clipmap.cacheEntry.markRendered(n)
  }
  return clipmap
}
/** A level's view-to-clip in centimetres: the clip depth of the light-space depth `z` (relative to
 *  the eye's level), 1 at the near side and 0 at the far one. */
export const clipDepth = (level: VsmClipmap['levels'][number], z: number) =>
  level.viewToClip[10] * z * 0.01 + level.viewToClip[14]
/** `frames` frames of the sun's first-person clipmap under `maps`, each marked rendered, the last returned. */
export function firstPersonFrames(
  cache: VsmCacheManager,
  frames: number,
  maps?: ReturnType<typeof mapsOf>,
) {
  let own!: VsmClipmap
  for (let n = 0; n < frames; n++) {
    cache.frameStamp = n
    const camera = { view: VIEW, projection: PROJECTION, perspective: true, eye: [0, 0, 0] }
    own = createVsmClipmap(
      cache,
      { ...SUN, firstPerson: true },
      camera,
      { width: 1024, height: 1024 },
      maps,
    )
    own.cacheEntry.markRendered(n)
  }
  return own
}
/** The distance, in centimetres, a level of absolute level `absoluteLevel` draws its moving casters to in
 *  a 1024-wide frame: its radius less the resolution bias of 1.5 (`vsmClipmapLevelRadiusCm`), in single
 *  precision. */
export const cullingEnd = (absoluteLevel: number) =>
  Math.fround(2 ** Math.fround(absoluteLevel - 1.5 + 1))
