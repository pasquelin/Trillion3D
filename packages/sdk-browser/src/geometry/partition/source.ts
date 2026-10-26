/**
 * THE VIEW AS THE STREAMING SOURCE OF A PARTITIONED SCENE, as the partition's scheme says
 * (`TablePartition.scheme`).
 *
 * The camera is the scene's one streaming source (`createStreamingSource`), its shape set by the
 * session's streaming settings (`WorldStreaming`, `WORLD_STREAMING_SETTINGS`): at its eye, seen
 * from above while the grid lies flat (`PartitionGrid.flat`) or the settings force the ground
 * (`force2D`), its up axis dropped, a circle of each grid's own loading range scaled
 * (`useGridRange`, `rangeScale`), or of one radius for every grid (`radius`), and in both a radius
 * longer by `extraRadius` — a sphere of it while they do not —; a sector of it around the view's
 * axis when the settings ask one (`sector`, `sectorAngle` and `extraAngle`, a whole turn at most).
 * A cell is wished while that shape meets the bounds it streams by (`meets`), and, a sector, not
 * wholly beside or behind it: on `hashSet`'s loose grids, the box around its content within or on
 * the circle, the sector around the view's own axis without its up part — or within or on the
 * sphere, the sector a cone around the view's axis that the box's bounding sphere meets —; on
 * `spatialHash`'s square grids, its square strictly within the circle, the sector around the
 * view's unit heading on the ground, and, when the settings cull by height (`zCulling`), its
 * content's height range meeting the eye's within the radius.
 *
 * The tests of the sector and of the height cull are `sourceShape.ts`'s. What ranks the cells
 * wished and not loaded by distance (`ranked`) is the scheme's too: the
 * order they load in, and how many load at once, are `loadOrder.ts`'s and `loadSlots.ts`'s.
 *
 * Cost: O(1) per cell tested or ranked.
 */
import { length2 } from '../../../../math/src/vector/vector.ts'
import { boxGroundDistance } from '../../../../math/src/geometry/boxDistance.ts'
import type { WorldStreaming } from '../../../../sdk-core/src/contracts/worldStreamingOptions.ts'
import type {
  PartitionGrid,
  TablePartition,
} from '../../../../sdk-core/src/scene/core/tablePartition.ts'
import type { LoadingCell } from './loadOrder.ts'
import { createSourceRank } from './sourceRank.ts'
import { createSourceShape, NO_HEADING, type ViewPose } from './sourceShape.ts'
import { watchSourceSettings } from './sourceSettings.ts'

/** A view standing still. */
const NO_VELOCITY = [0, 0, 0]

/** The view stands at `at` looking along the unit `axis`, heading `aim` on the ground; whether
 *  the eye, the axis or the heading moved, `moved` being whether a setting did. */
function movePose(
  pose: ViewPose,
  loose: boolean,
  settingsMoved: boolean,
  at: ArrayLike<number>,
  axis: ArrayLike<number>,
  aim: ArrayLike<number>,
) {
  const { eye, heading, eye3, axis3 } = pose
  let moved = settingsMoved
  for (let k = 0; k < 3; k++) {
    if (eye3[k] !== at[k] || axis3[k] !== axis[k]) moved = true
    eye3[k] = at[k]
    axis3[k] = axis[k]
  }
  eye[0] = at[0]
  eye[1] = at[2]
  // A loose grid's sector keeps the axis as it is, its up part dropped; a square grid's turns
  // the aim to a unit heading on the ground.
  const side = loose ? axis : aim
  const length = length2(side[0], side[2])
  pose.headed = length > NO_HEADING
  const scale = loose ? 1 : pose.headed ? 1 / length : 0
  moved ||= heading[0] !== side[0] * scale || heading[1] !== side[2] * scale
  heading[0] = side[0] * scale
  heading[1] = side[2] * scale
  return moved
}

/** Whether the view's shape for a grid meets the bounds `bounds` at `at` stream by (`meets`). */
function createMeets(
  streaming: WorldStreaming,
  loose: boolean,
  pose: ViewPose,
  shape: ReturnType<typeof createSourceShape>,
  radiusOf: (range: number) => number,
  solid: (flat: boolean) => boolean,
) {
  const { eye } = pose
  const { valid, besideSector, beyondHeight, gapTo, outsideCone } = shape
  /** Whether the view's shape for `grid` meets the bounds `bounds` at `at` stream by: within or
   *  on its radius in 3D and not outside its cone — a loose cell's content box on a grid that
   *  does not lie flat —; else on the ground within or on it — a loose cell's —, or strictly
   *  within it, and its content's height range meeting the eye's within it when the settings
   *  cull by height — a square cell's —, and not beside its sector. */
  return (
    bounds: ArrayLike<number>,
    at: number,
    { range, flat }: Pick<PartitionGrid, 'range' | 'flat'>,
  ) => {
    const radius = radiusOf(range)
    if (!valid(radius)) return false
    if (solid(flat)) return gapTo(bounds, at) <= radius * radius && !outsideCone(bounds, at)
    const away = boxGroundDistance(bounds, at, eye[0], eye[1])
    if (!(loose ? away <= radius : away < radius)) return false
    if (!loose && streaming.zCulling && beyondHeight(bounds, at, radius)) return false
    return !besideSector(bounds, at)
  }
}

/**
 * The view as the source for a partition of `scheme` whose grids (`hlod.grids`) lie flat or not,
 * under the settings `streaming` holds as they stand — read at each test, so a setting changed
 * takes from the next frame —, set each frame (`set`): its eye and the unit axis of its view, both
 * in the cells' frame. A flat loose grid's sector, or one the settings force to the ground
 * (`force2D`), turns around that axis with its up part dropped, unscaled; one that does not lie
 * flat around the axis itself; a square grid's around its unit heading on the ground, glTF's `+Y`
 * up dropped, which a view looking straight down takes from its up vector (`aimOf`).
 */
export function createStreamingSource(
  streaming: WorldStreaming,
  {
    scheme,
    hlod,
  }: Pick<TablePartition, 'scheme'> & { hlod: { grids: readonly { flat: boolean }[] } },
) {
  const loose = scheme === 'hashSet'
  /** Whether the cells of a loose grid that lies `flat` or not are wished in 3D, by a sphere: it
   *  does not lie flat and the settings do not force the ground. */
  const solid = (flat: boolean) => loose && !flat && !streaming.force2D
  const pose: ViewPose = {
    eye: [0, 0],
    heading: [0, 0],
    eye3: [0, 0, 0],
    axis3: [0, 0, 0],
    headed: false,
  }
  const shape = createSourceShape(streaming, loose, pose)
  const { sectored } = shape
  /** The circle's radius for a grid of loading range `range`, its extra radius added. */
  const radiusOf = (range: number) =>
    (streaming.useGridRange ? range * streaming.rangeScale : streaming.radius) +
    streaming.extraRadius
  const rank = createSourceRank(streaming, pose, shape, radiusOf)
  /** Whether a setting `meets` reads changed since the last `set`: what moves `revision` with the
   *  eye and the axis. */
  const settingsMoved = watchSourceSettings(streaming)
  const meets = createMeets(streaming, loose, pose, shape, radiusOf, solid)
  let revision = 0
  return {
    /** The view stands at `eye` looking along the unit `axis`, heading `aim` on the ground — the
     *  axis, but for a view looking straight down or up (`aimOf`) — and moving at `velocity`
     *  metres per second, all in the cells' frame. */
    set(at: ArrayLike<number>, axis: ArrayLike<number>, aim = axis, velocity = NO_VELOCITY) {
      if (movePose(pose, loose, settingsMoved(), at, axis, aim)) revision++
      rank.axisFor(axis, velocity)
    },
    /** Advances whenever what `meets` reads moved at a `set`: the eye, the axis or a setting. What
     *  it said at one revision it says at the same revision again. */
    get revision() {
      return revision
    },
    /** The circle's radius for a grid of loading range `range`. */
    radius: radiusOf,
    /** Whether the shape turns with the view: a sector, the view headed or a grid not flat — what
     *  it meets then moves with the view's axis, the eye standing. */
    turns: () => (pose.headed || hlod.grids.some(({ flat }) => solid(flat))) && sectored(),
    /** Whether the view's shape for a grid meets the bounds `bounds` at `at` stream by. */
    meets,
    /** What ranks the bounds `bounds` at `at` stream by, of a grid of loading range `range`, by
     *  distance (`LoadingCell`), as the scheme says (`looseRanked`, `squareRanked`). */
    ranked(bounds: ArrayLike<number>, at: number, range: number, out: LoadingCell) {
      return loose ? rank.loose(bounds, at, range, out) : rank.square(bounds, at, range, out)
    },
  }
}

export type StreamingSource = ReturnType<typeof createStreamingSource>
