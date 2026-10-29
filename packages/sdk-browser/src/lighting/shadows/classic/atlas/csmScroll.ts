/**
 * THE SCROLL OF A CLASSIC CASCADE'S CACHED MAP (`shadowVirtualEnable` off): when a sun's cascade slides with the view, the part of its cached static depth that the new
 * map still covers is copied over displaced instead of drawn again. This file holds the arithmetic of that choice and of the copy: the cache mode of a cascade (drawn whole, copied
 * as it is, scrolled, or drawn again to refresh the cache), the rectangles the overlap takes in the two maps, the depth the copy takes to the new map's range and the pixel
 * rectangles of the copy. Lengths are in the units of the light's space, any one unit; depths are device depths of the map (reversed).
 */

/** What a cascade's map draws this frame. */
export type CascadeCacheMode =
  /** No cache: the map is cleared and every caster drawn. */
  | 'uncached'
  /** The cached map is valid as it is: copied, then the movable casters drawn. */
  | 'movable'
  /** The cached map overlaps enough: copied displaced (scrolled), then the movable casters drawn. */
  | 'scrolling'
  /** The cache is drawn again with the static casters, then copied, then the movable casters drawn. */
  | 'refresh'

/** The settings that choose the mode (`r.Shadow.CSMCaching` as `enabled`, `r.Shadow.CSMScrollingOverlapAreaThrottle`, `r.Shadow.MaxCSMScrollingStaticShadowSubjects`). */
export interface CascadeCacheSettings {
  readonly enabled: boolean
  readonly overlapAreaThrottle: number
  readonly maxExtraStaticSubjects: number
}

/** The reference's defaults of the three settings. */
export const DEFAULT_CASCADE_CACHE: CascadeCacheSettings = {
  enabled: false,
  overlapAreaThrottle: 0.75,
  maxExtraStaticSubjects: 5,
}

/** A cascade's bounding sphere as the light sees it: where its centre lies in the light's space and its radius. */
export interface CascadeBounds {
  readonly centre: readonly [number, number, number]
  readonly radius: number
}

/** A rectangle in the light's plane (x right, y up). */
interface Rect {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/** The part two rectangles share, an empty one (all zero) where they share none. */
function overlap(a: Rect, b: Rect): Rect {
  const minX = Math.max(a.minX, b.minX)
  const minY = Math.max(a.minY, b.minY)
  const maxX = Math.min(a.maxX, b.maxX)
  const maxY = Math.min(a.maxY, b.maxY)
  return minX < maxX && minY < maxY
    ? { minX, minY, maxX, maxY }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
}

const around = (cx: number, cy: number, r: number): Rect => ({
  minX: cx - r,
  minY: cy - r,
  maxX: cx + r,
  maxY: cy + r,
})

/** The cached map's centre as seen from the current map's: the displacement the scroll takes. */
const displacement = (current: CascadeBounds, cached: CascadeBounds) =>
  [
    cached.centre[0] - current.centre[0],
    cached.centre[1] - current.centre[1],
    cached.centre[2] - current.centre[2],
  ] as const

/** The share of the cached map's area that the current map still covers, 0 to 1. */
export function overlapAreaRatio(current: CascadeBounds, cached: CascadeBounds) {
  const [dx, dy] = displacement(current, cached)
  const shared = overlap(around(0, 0, current.radius), around(dx, dy, cached.radius))
  return (
    ((shared.maxX - shared.minX) * (shared.maxY - shared.minY)) /
    (cached.radius * cached.radius * 4)
  )
}

/** What a cached state of a cascade holds of the frame before: whether its map is valid, drawn at the size now asked, and how many static casters it left out. */
export interface CascadeCacheState {
  /** The cached depth exists and has the size the map has now. */
  readonly valid: boolean
  /** The light's orientation, the map's range and the sphere's radius are those of the cache. */
  readonly sameProjection: boolean
  /** The sphere's centre and the map's range are exactly those of the cache. */
  readonly sameCentre: boolean
  /** The static casters the last scroll had to draw again. */
  readonly extraStaticSubjects: number
}

/**
 * The cache mode of a cascade: uncached where the cache is off or the projection turned; the cached map as it is where nothing moved; scrolled where the overlap with the
 * cache is above the throttle; else the cache is drawn again.
 */
export function cascadeCacheMode(
  settings: CascadeCacheSettings,
  state: CascadeCacheState | undefined,
  current: CascadeBounds,
  cached: CascadeBounds | undefined,
): CascadeCacheMode {
  if (!settings.enabled) return 'uncached'
  if (!state || !cached) return 'refresh'
  if (!state.sameProjection) return 'uncached'
  if (!state.valid || state.extraStaticSubjects > settings.maxExtraStaticSubjects) return 'refresh'
  if (state.sameCentre) return 'movable'
  return overlapAreaRatio(current, cached) > settings.overlapAreaThrottle ? 'scrolling' : 'refresh'
}

/** The four numbers of a rectangle as fractions of a map: (u0, v0, u1, v1), v down. */
export type UvRect = readonly [number, number, number, number]

/** What a scroll copies: the part of the cached map to read, the part of the current map to write, and the displacement in depth. */
export interface ScrollOverlap {
  readonly onCached: UvRect
  readonly onCurrent: UvRect
  readonly zOffset: number
}

/**
 * The rectangles of a scroll. `border` is the share of a side that the map's border adds (`(resolution + 2 border) / resolution`, 1 for none): the viewports are the spheres' squares
 * grown by it, as the maps are.
 */
export function scrollOverlap(
  current: CascadeBounds,
  cached: CascadeBounds,
  border = 1,
): ScrollOverlap {
  const [dx, dy, dz] = displacement(current, cached)
  const now = around(0, 0, current.radius * border)
  const before = around(dx, dy, cached.radius * border)
  const shared = overlap(now, before)
  const rect = (view: Rect): UvRect => {
    const w = view.maxX - view.minX
    const h = view.maxY - view.minY
    return [
      (shared.minX - view.minX) / w,
      (view.maxY - shared.maxY) / h,
      (shared.maxX - view.minX) / w,
      (view.maxY - shared.minY) / h,
    ]
  }
  return { onCached: rect(before), onCurrent: rect(now), zOffset: dz }
}

/** The depth range of a map: where its subject starts and ends along the light's axis and the inverse of the depth it spans. */
export interface SubjectRange {
  readonly minZ: number
  readonly maxZ: number
  readonly invMaxSubjectDepth: number
}

/**
 * The scale and offset the copy gives each cached depth, `depth * y + x`: the cached depth taken to the current map's range, the map having moved `zOffset` along the axis. A cleared
 * texel (depth 1) stays so. `depthBias` is the constant bias the map's depths carry.
 */
export function scrollDepthTransform(
  cached: SubjectRange,
  current: SubjectRange,
  zOffset: number,
  depthBias: number,
) {
  const cachedSpan = cached.maxZ - cached.minZ
  const currentSpan = current.maxZ - current.minZ
  const c1 = 1 + depthBias
  return {
    x:
      (current.invMaxSubjectDepth * (cached.maxZ + zOffset - current.maxZ) - c1 * cachedSpan) /
        currentSpan +
      c1,
    y: cachedSpan / currentSpan,
  }
}

/** A pixel rectangle: its corner and its size. */
export interface PixelRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** What the scroll's draw reads and writes, in pixels of maps `size` texels a side with their border: the source rectangle on the cached map and the output rectangle on the current one. */
export function scrollCopyRects(overlapUv: ScrollOverlap, size: number) {
  const px = (u: number) => Math.trunc(u * size + 0.5)
  const [cu0, cv0, cu1, cv1] = overlapUv.onCached
  const [nu0, nv0, nu1, nv1] = overlapUv.onCurrent
  const source: PixelRect = {
    x: px(cu0),
    y: px(cv0),
    width: Math.trunc((cu1 - cu0) * size + 0.5),
    height: Math.trunc((cv1 - cv0) * size + 0.5),
  }
  const x0 = px(nu0)
  const y0 = px(nv0)
  const output: PixelRect = { x: x0, y: y0, width: px(nu1) - x0, height: px(nv1) - y0 }
  return { source, output }
}
