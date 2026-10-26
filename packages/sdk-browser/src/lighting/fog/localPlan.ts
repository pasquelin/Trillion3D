import {
  localFogRadius,
  type ResolvedLocalFogVolume,
} from '../../../../sdk-core/src/scene/localFog/contracts.ts'
import { distanceVector3, length3 } from '../../../../math/src/vector/vector.ts'
import { LOCAL_FOG_FLAG, LOCAL_FOG_INSTANCE, LOCAL_FOG_SLOT } from './localLayout.ts'
import type { LocalFogTiling } from './localTiling.ts'

/** What the plan needs of the view: where the eye is, the view-projection the depth was drawn with as
 *  column-major numbers, the distance of its near plane, its size in pixels. */
export interface LocalFogView {
  eye: ArrayLike<number>
  viewProj: ArrayLike<number>
  near: number
  size: ArrayLike<number>
}

/** The sun the volumes are lit by: its light — colour times illuminance — and the unit direction toward
 *  it; none where the view has no directional light. */
export interface LocalFogSun {
  light: ArrayLike<number>
  toward: ArrayLike<number>
}

/** The settings of the plan, held to their ranges (`localFogLimits`). */
export interface LocalFogPlanSettings {
  inVolume: boolean
  onTranslucent: boolean
  startDistance: number
  maxVolumeDensity: number
  maxCount: number
}

/** The scale of the falloff a volume's number is written in: the number over a hundred is the falloff
 *  per unit of its sphere, which the density's exponent reads. */
const LOCAL_FOG_FALLOFF_SCALE = 0.01
/** The priority a volume's own is turned about, so that a higher priority sorts later (nearer). */
const PRIORITY_TURN = 127

/** A volume the plan keeps: its distance to the eye as a 32-bit float, its place in the store, its
 *  radius. */
interface Planned {
  volume: ResolvedLocalFogVolume
  distance: number
  order: number
  radius: number
}

/** The volumes that can show at all: one with neither radial nor height extinction never does. */
const shows = (volume: ResolvedLocalFogVolume) =>
  volume.radialDensity > 0 || volume.heightDensity > 0

/** The records the plan fills, kept from one call to the next, and the order it draws them in. */
const pool: Planned[] = []
const planned: Planned[] = []

/** The priority turned about 127 (the larger sorts first), then the distance, then the place: the
 *  larger first, so that the last are the nearest and the highest in priority. */
const turned = (p: Planned) => PRIORITY_TURN - p.volume.sortPriority
const drawnAfter = (a: Planned, b: Planned) =>
  turned(b) - turned(a) || b.distance - a.distance || b.order - a.order

/**
 * The volumes that can show, in `planned`, in the order they are drawn, each over those before it: by
 * priority — a lower one behind a higher —, then by distance of the centre to the eye — the farther
 * behind —, then by their place in the store, the later behind. Returns how many.
 */
function sortLocalFog(volumes: Iterable<ResolvedLocalFogVolume>, eye: ArrayLike<number>) {
  let n = 0
  for (const volume of volumes) {
    if (!shows(volume)) continue
    const p = (pool[n] ??= { volume, distance: 0, order: 0, radius: 0 })
    p.volume = volume
    p.distance = Math.fround(distanceVector3(volume.matrix, eye, 12))
    p.order = n
    p.radius = localFogRadius(volume)
    planned[n++] = p
  }
  planned.length = n
  planned.sort(drawnAfter)
  return n
}

/** Writes the slot `slot` of `out` from four numbers. */
function putSlot(out: Float32Array, slot: number, a: number, b: number, c: number, d: number) {
  const i = slot * 4
  out[i] = a
  out[i + 1] = b
  out[i + 2] = c
  out[i + 3] = d
}

/** Writes the volume `p` as the instance `at` of `out`, relative to the eye. The height axis is the
 *  matrix's own up, its second column made a unit (the law turns about it unchanged, so no more of the
 *  rotation is kept). */
function putInstance(out: Float32Array, at: number, p: Planned, eye: ArrayLike<number>) {
  const { volume } = p
  const m = volume.matrix
  const base = LOCAL_FOG_SLOT.instances + at * LOCAL_FOG_INSTANCE.slots
  const up = 1 / length3(m[4], m[5], m[6])
  putSlot(
    out,
    base + LOCAL_FOG_INSTANCE.centre,
    m[12] - eye[0],
    m[13] - eye[1],
    m[14] - eye[2],
    p.radius,
  )
  putSlot(
    out,
    base + LOCAL_FOG_INSTANCE.axis,
    m[4] * up,
    m[5] * up,
    m[6] * up,
    volume.startDistance,
  )
  putSlot(
    out,
    base + LOCAL_FOG_INSTANCE.law,
    volume.radialDensity,
    volume.heightDensity,
    volume.heightFalloff * LOCAL_FOG_FALLOFF_SCALE,
    volume.heightOffset,
  )
  const [r, g, b] = volume.albedo
  putSlot(out, base + LOCAL_FOG_INSTANCE.albedo, r, g, b, volume.scatteringDistribution)
  const [er, eg, eb] = volume.emissive
  putSlot(out, base + LOCAL_FOG_INSTANCE.emissive, er, eg, eb, 0)
}

/** The view written into `out` (`LOCAL_FOG_SLOT.projection`, `screen`, `tiling`): the rows of its
 *  view-projection for a point relative to the eye — the row's three numbers, then what the eye
 *  itself gives it —, its size, its near distance and the words the tiles' lists take, and the tiling
 *  (all zero where the view is not tiled). */
function putView(out: Float32Array, view: LocalFogView, tiling: LocalFogTiling | undefined) {
  const m = view.viewProj
  const { eye } = view
  const x = eye[0],
    y = eye[1],
    z = eye[2]
  for (let row = 0; row < 4; row++)
    putSlot(
      out,
      LOCAL_FOG_SLOT.projection + row,
      m[row],
      m[4 + row],
      m[8 + row],
      m[row] * x + m[4 + row] * y + m[8 + row] * z + m[12 + row],
    )
  putSlot(out, LOCAL_FOG_SLOT.screen, view.size[0], view.size[1], view.near, tiling?.words ?? 0)
  if (tiling)
    putSlot(out, LOCAL_FOG_SLOT.tiling, tiling.size, tiling.across, tiling.down, tiling.stride)
  else putSlot(out, LOCAL_FOG_SLOT.tiling, 0, 0, 0, 0)
}

/** A vector of the sun in `slot` — its light, or the direction toward it — with `lane` after it; zero where the view has no sun. */
function putSun(out: Float32Array, slot: number, v: ArrayLike<number> | undefined, lane: number) {
  putSlot(out, slot, v ? v[0] : 0, v ? v[1] : 0, v ? v[2] : 0, v ? lane : 0)
}

/**
 * The block of the light buffer for the view (`localLayout.ts`): the header, the sun, the view, and
 * the volumes in the order they are drawn (`sortLocalFog`) — the most `maxCount` of the store's, the
 * nearest and those of the highest priority, each relative to the eye. None is dropped for lying
 * outside the view: the culling pass keeps each tile's list (`localCullWgsl.ts`). `tiling` is the
 * tiling that pass lists the volumes by, none where it does not run; it is written only where a volume
 * is. Returns how many volumes it wrote; the sky's rows are the GPU's and are left as they are.
 */
export function planLocalFog(
  out: Float32Array,
  volumes: Iterable<ResolvedLocalFogVolume>,
  view: LocalFogView,
  sun: LocalFogSun | undefined,
  settings: LocalFogPlanSettings,
  tiling?: LocalFogTiling,
) {
  const total = sortLocalFog(volumes, view.eye)
  const first = Math.max(0, total - settings.maxCount)
  const count = total - first
  for (let k = 0; k < count; k++) putInstance(out, k, planned[first + k], view.eye)
  const flags =
    (settings.inVolume ? LOCAL_FOG_FLAG.inVolume : 0) |
    (settings.onTranslucent ? LOCAL_FOG_FLAG.onTranslucent : 0)
  putSlot(
    out,
    LOCAL_FOG_SLOT.header,
    count,
    flags,
    settings.maxVolumeDensity,
    settings.startDistance,
  )
  putSun(out, LOCAL_FOG_SLOT.sunLight, sun?.light, 1)
  putSun(out, LOCAL_FOG_SLOT.sunDirection, sun?.toward, 0)
  putView(out, view, count ? tiling : undefined)
  return count
}
