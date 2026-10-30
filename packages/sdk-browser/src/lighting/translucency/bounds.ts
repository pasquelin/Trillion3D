import { LIGHT_FIELD, baseOf } from '../../../../sdk-core/src/scene/light/fields.ts'
import { LIGHT_KIND, SCENE_LIGHT_FLOATS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import type { SimpleLights } from '../../../../sdk-core/src/scene/light/simpleLights.ts'
import { DEG2RAD, QUARTER_PI } from '../../../../math/src/constants.ts'
import type { TranslucencyVolumeValues } from '../../../../sdk-core/src/contracts/translucencyVolumeOptions.ts'
import { TRANSLUCENCY_CASCADES } from './layout.ts'

/**
 * WHERE THE TWO CASCADES LIE, and which lights reach each: the volume follows the camera, a cube of cells that
 * holds a stretch of its view, its centre snapped to a whole number of cells.
 *
 * A cascade is the bounding sphere of the stretch of the view frustum it holds: eight corners, the stretch's
 * start and end distance along the view, each as far from the axis as the field of view puts it (a field of 45
 * degrees and a square view, or, where `translucencyVolumeAdaptToPerspective` is on, the camera's own,
 * at least `translucencyVolumeMinFov`, rounded up to a multiple of `translucencyVolumeFovSnap`). The sphere's centre is the
 * corners' mean weighted ten times more for those of the far side, so that it lies away from the camera and
 * wastes no cells behind it; its radius reaches the furthest corner. The centre is snapped to the cells' side
 * (a multiple of twice the radius over the cells a side, toward zero), the volume the cube round it.
 */
export interface Cascade {
  /** The corner of the cube with the least coordinates, metres. */
  readonly min: [number, number, number]
  /** The side of the cube, metres: 0 for a stretch that holds nothing. */
  size: number
  /** The side of a cell, metres. */
  voxel: number
}

/** What the cascades are placed from: the camera, and its projection's scales. */
export interface CascadeView {
  /** The eye, and the unit axes of the camera: where it looks, its right and its up. */
  readonly eye: ArrayLike<number>
  readonly forward: ArrayLike<number>
  readonly right: ArrayLike<number>
  readonly up: ArrayLike<number>
  /** The projection's first two diagonal terms: the scale of x and of y. */
  readonly scaleX: number
  readonly scaleY: number
  /** Whether the projection is a perspective one. */
  readonly perspective: boolean
}

/** The weight the far corners of a stretch take against the near ones in the sphere's centre. */
const FAR_VERTEX_WEIGHT_SCALE = 10
/** The field of view and the aspect a cascade follows where the camera's own are not asked for: 45 degrees, square. */
const DEFAULT_FIELD_OF_VIEW = QUARTER_PI

/** The signs a corner of a stretch lies across the view by (right, up), the order of the corners the centre is weighed over
 *  (`placeCascade`): the near four, then the far four, the same four signs each. */
const SIGNS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const
/** The scratch an image places its cascades in: the eight corners and their weighted centre. */
const CORNERS = new Float64Array(24)
const CENTRE = new Float64Array(3)

/** A new cascade, holding nothing. */
export const newCascade = (): Cascade => ({ min: [0, 0, 0], size: 0, voxel: 0 })

/** The stretch's eight corners — the near four, then the far four, each across the view by the signs
 *  of `SIGNS` — into the scratch. */
function fillCorners(
  view: CascadeView,
  start: number,
  end: number,
  startAcross: number,
  endAcross: number,
  aspect: number,
) {
  for (let v = 0; v < 8; v++) {
    const along = v < 4 ? start : end
    const across = v < 4 ? startAcross : endAcross
    const right = across * SIGNS[v][0]
    const up = (across / aspect) * SIGNS[v][1]
    for (let k = 0; k < 3; k++)
      CORNERS[v * 3 + k] =
        view.eye[k] + view.forward[k] * along + view.right[k] * right + view.up[k] * up
  }
}

/** The corners' weighted centre, into the scratch. */
function weightedCentre() {
  CENTRE[0] = CENTRE[1] = CENTRE[2] = 0
  for (let v = 0; v < 8; v++) {
    const weight =
      v > 3 ? 1 / (4 + 4 / FAR_VERTEX_WEIGHT_SCALE) : 1 / (4 + 4 * FAR_VERTEX_WEIGHT_SCALE)
    for (let k = 0; k < 3; k++) CENTRE[k] += CORNERS[v * 3 + k] * weight
  }
}

/** The greatest squared distance from the centre to a corner. */
function farthestCorner() {
  let radiusSquared = 0
  for (let v = 0; v < 8; v++) {
    let d = 0
    for (let k = 0; k < 3; k++) d += (CENTRE[k] - CORNERS[v * 3 + k]) ** 2
    radiusSquared = Math.max(radiusSquared, d)
  }
  return radiusSquared
}

/**
 * Places cascade `index` into `out` from the camera `view` and the volume's settings `s`: the stretch of the view
 * it holds (the first from the camera to the inner distance, the second from there to the outer one),
 * its sphere, its snapped cube of `dim` cells a side. A stretch with no extent leaves `size` at 0.
 */
export function placeCascade(
  out: Cascade,
  index: number,
  view: CascadeView,
  s: Pick<
    TranslucencyVolumeValues,
    | 'translucencyVolumeInnerDistance'
    | 'translucencyVolumeOuterDistance'
    | 'translucencyVolumeAdaptToPerspective'
    | 'translucencyVolumeMinFov'
    | 'translucencyVolumeFovSnap'
  >,
  dim: number,
) {
  const inner = s.translucencyVolumeInnerDistance
  const outer = s.translucencyVolumeOuterDistance
  const start = index === 0 ? 0 : inner
  const end = index === 0 ? inner : outer
  let fieldOfView = DEFAULT_FIELD_OF_VIEW
  let aspect = 1
  if (view.perspective && s.translucencyVolumeAdaptToPerspective) {
    // The camera's own half field, held to the least the settings name and rounded up to a step, so that the
    // volume jumps in steps as the field animates, never crawls.
    fieldOfView = Math.atan(1 / view.scaleX)
    fieldOfView = Math.max(fieldOfView, s.translucencyVolumeMinFov * DEG2RAD)
    const round = s.translucencyVolumeFovSnap * DEG2RAD
    fieldOfView = fieldOfView + round - (fieldOfView % round)
    aspect = view.scaleY / view.scaleX
  }
  // The tangent of a field close to 180 degrees explodes: held to the diagonal of a cube of the outer distance.
  const mostTan = Math.sqrt(Math.max(1, 3 * outer * outer))
  const tan = Math.tan(fieldOfView)
  const startAcross = Math.min(mostTan, start * tan)
  const endAcross = Math.min(mostTan, end * tan)
  fillCorners(view, start, end, startAcross, endAcross, aspect)
  weightedCentre()
  const radiusSquared = farthestCorner()
  if (!(radiusSquared > 0)) {
    out.size = out.voxel = 0
    return out
  }
  const radius = Math.sqrt(radiusSquared)
  const step = (radius * 2) / dim
  for (let k = 0; k < 3; k++) {
    const snapped = CENTRE[k] - (CENTRE[k] % step)
    out.min[k] = snapped - radius
  }
  out.size = radius * 2
  out.voxel = out.size / dim
  return out
}

/** The whole count of cells a range of lights' extent covers along an axis, as the cells are counted from the
 *  cascade's corner: from the cell the extent's start falls in to one past the cell its end falls in, held to the
 *  cascade. A range wholly outside holds none (`max <= min`). */
function cellsOf(centre: number, radius: number, min: number, voxel: number, dim: number) {
  const first = Math.max(Math.trunc((centre - radius - min) / voxel), 0)
  const last = Math.min(Math.trunc((centre + radius - min) / voxel) + 1, dim)
  return last > first
}

/** Whether the local light whose record starts at `base` reaches a cell of `cascade`: its range is above 0 and its sphere meets the cube. */
function reachesCell(packed: ArrayLike<number>, base: number, cascade: Cascade, dim: number) {
  const radius = packed[base + LIGHT_FIELD.range]
  let reaches = radius > 0
  for (let k = 0; k < 3 && reaches; k++)
    reaches = cellsOf(
      packed[base + LIGHT_FIELD.position + k],
      radius,
      cascade.min[k],
      cascade.voxel,
      dim,
    )
  return reaches
}

/**
 * The lights each cascade is lit by, as their ranks (the light buffer's order): every directional light, and every
 * local light whose sphere of reach holds a cell of the cascade, written into `out` — the first cascade's, then the
 * second's —; `counts` receives how many each holds. `packed` is the light store's table (`SceneLightStore.packed`).
 * `out` is at least twice `count` long. The simple lights that affect translucency follow the store's lights in the buffer (their rank
 * is `count` plus their slot) and are listed after each cascade's own lights by the same reach.
 */
export function cullLights(
  packed: ArrayLike<number>,
  kindOf: (slot: number) => number,
  count: number,
  cascades: readonly Cascade[],
  dim: number,
  out: Uint32Array,
  counts: Uint32Array,
  simple?: Pick<SimpleLights, 'count' | 'packed' | 'affectsTranslucency'>,
) {
  let at = 0
  for (let c = 0; c < TRANSLUCENCY_CASCADES; c++) {
    const cascade = cascades[c]
    const first = at
    if (cascade.size > 0) {
      for (let slot = 0; slot < count; slot++)
        if (
          kindOf(slot) === LIGHT_KIND.directional ||
          reachesCell(packed, baseOf(slot), cascade, dim)
        )
          out[at++] = slot
      for (let slot = 0; slot < (simple?.count ?? 0); slot++)
        if (
          simple!.affectsTranslucency(slot) &&
          reachesCell(simple!.packed, slot * SCENE_LIGHT_FLOATS, cascade, dim)
        )
          out[at++] = count + slot
    }
    counts[c] = at - first
  }
  return counts
}
