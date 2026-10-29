import { sameValues } from '../../../../../../math/src/matrix/matrixElements.ts'
import {
  cascadeCacheMode,
  scrollOverlap,
  type CascadeBounds,
  type CascadeCacheMode,
  type CascadeCacheSettings,
} from './csmScroll.ts'

/**
 * THE CACHE OF A SUN'S CLASSIC CASCADES, FRAME TO FRAME (`shadowCsmCaching`): for each cascade the sphere, the clipmap level and the light's direction its cached depths were drawn
 * with, the casters that were static then and how many static casters the last scrolled frame had to draw again. `planCascadeCaches` chooses each cascade's mode from them
 * (`cascadeCacheMode`) and names the cascades whose cache is drawn again whole: a cascade whose projection turned or whose cache overlaps the map too little. The clipmap's
 * pages are on a world grid and shift with the cascade's map (`VsmMapCache.updateLevel`), so a scrolled cascade keeps the pages it still covers and draws the others, which is what the
 * scroll's copy and its strips do; the modes the cascade's pages must not be carried in are the only thing left to decide here.
 */

/** What one cascade held when its cache was last drawn. */
export interface CascadeRecord {
  centre: [number, number, number]
  radius: number
  /** The clipmap level (the index from the first) the cascade is drawn in. */
  level: number
  direction: [number, number, number]
  /** The static casters the last scrolled frame had to draw again (`CascadeCacheState.extraStaticSubjects`). */
  extra: number
  /** The static casters whose depths the cache holds. */
  seen: WeakSet<object>
}

/** A cascade this frame: its sphere in the world and the level it lies in. */
export interface CascadeNow {
  readonly centre: readonly [number, number, number]
  readonly radius: number
  readonly level: number
}

/** The casters the cache is made of. */
export interface CascadeRoots {
  readonly count: number
  /** Placement `rank`'s identity. */
  objectAt(rank: number): object
  /** The world box (min then max, six numbers) of placement `rank` when it is a static caster of the light, else undefined. */
  staticBox(rank: number): ArrayLike<number> | undefined
}

/** The light's frame: its direction and the rotation (4x4, column-major, rotation only) from the world to its space. */
export interface CascadeLight {
  readonly direction: readonly [number, number, number]
  readonly rotation: ArrayLike<number>
}

/** Bounds written in place. */
interface Bounds {
  centre: [number, number, number]
  radius: number
}

/** The light-space bounds of a sphere at world centre `centre` (the rotation's three rows applied to it). */
const boundsOf = (
  rotation: ArrayLike<number>,
  centre: readonly [number, number, number],
  radius: number,
  into: Bounds,
): CascadeBounds => {
  const [x, y, z] = centre
  const out = into.centre
  out[0] = rotation[0]! * x + rotation[4]! * y + rotation[8]! * z
  out[1] = rotation[1]! * x + rotation[5]! * y + rotation[9]! * z
  out[2] = rotation[2]! * x + rotation[6]! * y + rotation[10]! * z
  into.radius = radius
  return into
}

/** The light-plane rectangle (min x, min y, max x, max y) of every static caster this frame, four numbers a placement, NaN where it is not a static caster of the light: the corners' extremes, found once for all the cascades. */
let rectScratch = new Float64Array(0)
function fillRects(roots: CascadeRoots, m: ArrayLike<number>) {
  if (rectScratch.length < roots.count * 4) rectScratch = new Float64Array(roots.count * 4)
  for (let rank = 0; rank < roots.count; rank++) {
    const at = rank * 4
    const box = roots.staticBox(rank)
    if (!box) {
      rectScratch[at] = NaN
      continue
    }
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let corner = 0; corner < 8; corner++) {
      const x = box[corner & 1 ? 3 : 0]!
      const y = box[corner & 2 ? 4 : 1]!
      const z = box[corner & 4 ? 5 : 2]!
      const u = m[0]! * x + m[4]! * y + m[8]! * z
      const v = m[1]! * x + m[5]! * y + m[9]! * z
      minX = Math.min(minX, u)
      maxX = Math.max(maxX, u)
      minY = Math.min(minY, v)
      maxY = Math.max(maxY, v)
    }
    rectScratch[at] = minX
    rectScratch[at + 1] = minY
    rectScratch[at + 2] = maxX
    rectScratch[at + 3] = maxY
  }
}

/** The static casters whose rectangle (`fillRects`) meets the square of the cascade `now` (around the sphere's centre, the half side `half`), each with its rectangle's first number in the scratch. */
function staticsIn(
  roots: CascadeRoots,
  now: CascadeBounds,
  half: number,
  visit: (object: object, at: number) => void,
) {
  const r = rectScratch
  for (let rank = 0; rank < roots.count; rank++) {
    const at = rank * 4
    if (Number.isNaN(r[at]!)) continue
    if (
      r[at + 2]! < now.centre[0] - half ||
      r[at]! > now.centre[0] + half ||
      r[at + 3]! < now.centre[1] - half ||
      r[at + 1]! > now.centre[1] + half
    )
      continue
    visit(roots.objectAt(rank), at)
  }
}

/** The static casters a scrolled frame draws again: those the cache does not hold and those that reach into the strips the cascade newly covers. */
function extraStatics(
  roots: CascadeRoots,
  record: CascadeRecord,
  now: CascadeNow,
  nowBounds: CascadeBounds,
  cached: CascadeBounds,
) {
  // The overlap in the plane of the current map, from the displaced cached sphere.
  const [u0, v0, u1, v1] = scrollOverlap(nowBounds, cached).onCurrent
  const side = nowBounds.radius * 2
  const left = nowBounds.centre[0] - nowBounds.radius + u0 * side
  const right = nowBounds.centre[0] - nowBounds.radius + u1 * side
  const top = nowBounds.centre[1] + nowBounds.radius - v0 * side
  const bottom = nowBounds.centre[1] + nowBounds.radius - v1 * side
  const r = rectScratch
  let extra = 0
  staticsIn(roots, nowBounds, now.radius, (object, at) => {
    if (
      !record.seen.has(object) ||
      r[at + 3]! > top ||
      r[at + 1]! < bottom ||
      r[at]! < left ||
      r[at + 2]! > right
    ) {
      extra++
      // Drawn again this frame, so the depths the cache now holds include it.
      record.seen.add(object)
    }
  })
  return extra
}

/** A cascade's cache drawn anew at `now`: the record takes its sphere and the static casters its depths hold. */
function refreshRecord(
  record: CascadeRecord,
  now: CascadeNow,
  light: CascadeLight,
  roots: CascadeRoots,
  nowBounds: CascadeBounds,
) {
  for (let i = 0; i < 3; i++) record.centre[i] = now.centre[i]!
  record.radius = now.radius
  record.level = now.level
  for (let i = 0; i < 3; i++) record.direction[i] = light.direction[i]!
  record.extra = 0
  record.seen = new WeakSet()
  staticsIn(roots, nowBounds, now.radius, (object) => record.seen.add(object))
}

const dropped = new Set<number>()
const boundsNow: Bounds = { centre: [0, 0, 0], radius: 0 }
const boundsCached: Bounds = { centre: [0, 0, 0], radius: 0 }

/**
 * The cache modes of a sun's cascades this frame, and the cascades (their index, that of their map past the clipmap's levels) whose pages must not be carried over (a cascade whose cache is drawn again whole: `refresh` or `uncached`).
 * `records` is the sun's, by cascade, kept from frame to frame and updated here; a record for each of the first `count` cascades of `cascades`. The set returned is one the next call empties and fills again.
 */
export function planCascadeCaches(
  settings: CascadeCacheSettings,
  records: CascadeRecord[],
  cascades: readonly CascadeNow[],
  light: CascadeLight,
  roots: CascadeRoots,
  count = cascades.length,
) {
  dropped.clear()
  records.length = count
  fillRects(roots, light.rotation)
  for (let k = 0; k < count; k++) {
    const now = cascades[k]!
    const record = records[k]
    const nowBounds = boundsOf(light.rotation, now.centre, now.radius, boundsNow)
    const cached = record && boundsOf(light.rotation, record.centre, record.radius, boundsCached)
    const mode: CascadeCacheMode = cascadeCacheMode(
      settings,
      record && {
        valid: record.level === now.level,
        sameProjection:
          sameValues(record.direction, light.direction) && record.radius === now.radius,
        sameCentre: sameValues(record.centre, now.centre),
        extraStaticSubjects: record.extra,
      },
      nowBounds,
      cached,
    )
    if (mode === 'refresh' || mode === 'uncached') {
      dropped.add(k)
      const fresh = (records[k] ??= {
        centre: [0, 0, 0],
        radius: 0,
        level: now.level,
        direction: [0, 0, 0],
        extra: 0,
        seen: new WeakSet(),
      })
      refreshRecord(fresh, now, light, roots, nowBounds)
    } else if (mode === 'scrolling' && record && cached) {
      record.extra = extraStatics(roots, record, now, nowBounds, cached)
    }
  }
  return dropped
}
