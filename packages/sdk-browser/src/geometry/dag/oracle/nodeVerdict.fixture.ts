// The kernel's verdict on a cut node and its floor, in JavaScript over the frames of `math.fixture.ts`.
import { frustumExcludesBox } from '../../../../../math/src/geometry/frustum/box.ts'
import { errorFloorAt, viewDepthOf } from '../../selection/projection.fixture.ts'
import { DAG_NODE_FLOATS } from '../types.ts'
import {
  NODE_CEIL,
  NODE_CHILD_COUNT,
  NODE_FLOOR,
  NODE_MAX,
  NODE_MIN,
  NODE_OPEN,
  NODE_SPHERE,
  TREE_DRAW_FAR,
  TREE_DRAW_NEAR,
} from '../nodeLayout.ts'
import { projectedError, type DagViewFrames } from './math.fixture.ts'
import { outsideDrawDistances } from '../drawDistanceOracle.fixture.ts'
import { REQUEST_CATEGORY, REQUEST_PRIORITY_MAX, REQUEST_PRIORITY_MIN } from '../request/request.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import { clamp } from '../../../../../math/src/scalar/reals.ts'

/** The projected replacement ceiling of node `n` read by placement `w`, in pixels: what the
 *  descent compares to the threshold (`dagNodeVerdict`) and a kept leaf's request priority reads
 *  (`dagLeafPriority`). */
function projectedCeiling(f: DagViewFrames, nodes: ArrayLike<number>, n: number, w: number) {
  const base = n * DAG_NODE_FLOATS
  return projectedError(
    nodes[base + NODE_CEIL],
    nodes[base + NODE_SPHERE],
    nodes[base + NODE_SPHERE + 1],
    nodes[base + NODE_SPHERE + 2],
    nodes[base + NODE_SPHERE + 3],
    f.views[w],
    f.stretches[w],
    f.focal,
    f.near,
    f.perspective,
  )
}

/** Kernel verdict on a cut node read by placement `w` (`../shader/levelWgsl.ts`, `levelStep`):
 *  `-1` rejected — outside the trunk, or whose subtree replacement is not yet too coarse —,
 *  otherwise the number of children it opens, `0` meaning a kept leaf. */
export function dagNodeVerdict(
  f: DagViewFrames,
  nodes: ArrayLike<number>,
  ints: Uint32Array,
  n: number,
  w: number,
) {
  const base = n * DAG_NODE_FLOATS
  if (
    frustumExcludesBox(
      f.planes[w],
      nodes[base + NODE_MIN],
      nodes[base + NODE_MIN + 1],
      nodes[base + NODE_MIN + 2],
      nodes[base + NODE_MAX],
      nodes[base + NODE_MAX + 1],
      nodes[base + NODE_MAX + 2],
    )
  )
    return -1
  if (nodes[base + NODE_CEIL] >= 0 && projectedCeiling(f, nodes, n, w) <= f.pixelError) return -1
  return ints[base + NODE_CHILD_COUNT]
}

/** The request priority word of kept leaf `n` read by placement `w` (`leafPriority`,
 *  `../shader/error.ts`): the error its pages replace, its reach over the threshold — one or more
 *  for a leaf the cut keeps —, unbounded without a ceiling; the float's bits under the camera's
 *  category (`requestPriority`). */
export function dagLeafPriority(f: DagViewFrames, nodes: ArrayLike<number>, n: number, w: number) {
  const reach =
    nodes[n * DAG_NODE_FLOATS + NODE_CEIL] >= 0
      ? projectedCeiling(f, nodes, n, w) / f.pixelError
      : Infinity
  return requestPriority(reach)
}

/** The CPU mirror of `requestPriority` (`../shader/error.ts`): the camera's category in the top two
 *  bits, the single-precision bits of `priority` below them, within the range the host's heap
 *  keeps (`../request/request.ts`). */
const requestPriority = (priority: number) =>
  clamp(
    ((REQUEST_CATEGORY << 30) | (f32Bits(priority) >>> 2)) >>> 0,
    REQUEST_PRIORITY_MIN,
    REQUEST_PRIORITY_MAX,
  )

/**
 * A leaf's error FLOOR, projected as the kernel projects it (`../shader/floorWgsl.ts`,
 * `floorPrunes`) through its LOD ball: above the threshold none of its clusters is fine enough and
 * the cut takes none. An inner node, and an open leaf — it holds a cluster whose finer group is not
 * resident, which the cut rule may draw whatever its error —, return zero, so never prune. `open`,
 * placement `w`'s own count there (`../heldOpen.ts`); the node's, shared, when it holds none.
 */
export function dagNodeFloor(
  f: DagViewFrames,
  nodes: ArrayLike<number>,
  ints: Uint32Array,
  n: number,
  w: number,
  open = ints[n * DAG_NODE_FLOATS + NODE_OPEN],
) {
  const base = n * DAG_NODE_FLOATS
  if (open !== 0 || ints[base + NODE_CHILD_COUNT] > 0) return 0
  return errorFloorAt(
    nodes[base + NODE_FLOOR],
    viewDepthOf(
      nodes[base + NODE_SPHERE],
      nodes[base + NODE_SPHERE + 1],
      nodes[base + NODE_SPHERE + 2],
      f.views[w],
    ),
    nodes[base + NODE_SPHERE + 3],
    f.stretches[w],
    f.focal,
    f.perspective,
  )
}

/** The kernel's verdict on a cell or a group of the placement tree
 *  (`../shader/placementTreeWgsl.ts`, `treeStep`): `-1` when its world box, the eye taken off it,
 *  leaves the render-frame frustum, otherwise the number of children it opens. */
export function dagTreeVerdict(
  f: DagViewFrames,
  nodes: ArrayLike<number>,
  ints: Uint32Array,
  n: number,
) {
  const base = n * DAG_NODE_FLOATS,
    [x, y, z] = f.cameraWorld
  const lo = base + NODE_MIN,
    hi = base + NODE_MAX
  if (
    frustumExcludesBox(
      f.viewPlanes,
      nodes[lo] - x,
      nodes[lo + 1] - y,
      nodes[lo + 2] - z,
      nodes[hi] - x,
      nodes[hi + 1] - y,
      nodes[hi + 2] - z,
    )
  )
    return -1
  // The distances its placements are drawn at, where they name some (a cell holds none).
  const eye = [x, y, z]
  if (
    outsideGroupDrawDistance(
      nodes[base + TREE_DRAW_NEAR],
      nodes[base + TREE_DRAW_FAR],
      eye.map((e, a) => nodes[lo + a] - e),
      eye.map((e, a) => nodes[hi + a] - e),
    )
  )
    return -1
  return ints[base + NODE_CHILD_COUNT]
}

/**
 * The kernel's verdict on the distances a placement is drawn at (`outsideDrawDistance`,
 * `../shader/drawDistanceWgsl.ts`): whether the sphere of its root's bounds `lo`–`hi` (in the
 * placement's space), at the pose `world` (column-major, in doubles) seen from `eye`, lies wholly
 * out of `distance` times `scale` — the sphere's radius the box's half diagonal at the pose's
 * greatest scale held to the half diagonal of the box the pose makes of it, none for one instance
 * of an instanced mesh. None for a placement that names no distance.
 */
export function outsideRootDrawDistance(
  distance: { min: number; max: number; perInstance: boolean } | undefined,
  world: ArrayLike<number>,
  eye: readonly number[],
  lo: ArrayLike<number>,
  hi: ArrayLike<number>,
  scale = 1,
) {
  if (!distance) return false
  const centre = [0, 1, 2].map((a) => 0.5 * (lo[a] + hi[a])),
    half = [0, 1, 2].map((a) => 0.5 * (hi[a] - lo[a]))
  const away = [0, 1, 2].map(
    (i) =>
      world[i] * centre[0] +
      world[4 + i] * centre[1] +
      world[8 + i] * centre[2] +
      world[12 + i] -
      eye[i],
  )
  let radius = 0
  if (!distance.perInstance) {
    const rows = [0, 1, 2].map((i) => world[i] ** 2 + world[4 + i] ** 2 + world[8 + i] ** 2),
      extent = [0, 1, 2].map(
        (i) =>
          Math.abs(world[i]) * half[0] +
          Math.abs(world[4 + i]) * half[1] +
          Math.abs(world[8 + i]) * half[2],
      )
    radius = Math.min(Math.hypot(...half) * Math.sqrt(Math.max(...rows)), Math.hypot(...extent))
  }
  return outsideDrawDistances(Math.hypot(...away), radius, distance.min, distance.max, scale)
}

/**
 * The kernel's verdict on the group above the root of an instance of an assembly
 * (`outsideRootParent`, `../shader/rootParentWgsl.ts`): whether `error`, projected through the ball
 * `sphere` — centre then radius, in the placement's space — read by placement `w`, is under the
 * threshold: nothing of the instance is visited, the group's own clusters draw. The comparison of
 * `dagNodeVerdict`'s ceiling, an error that shows being one the cut still needs finer.
 */
export function outsideRootParent(
  f: Pick<DagViewFrames, 'views' | 'stretches' | 'focal' | 'near' | 'perspective' | 'pixelError'>,
  w: number,
  error: number,
  sphere: ArrayLike<number>,
) {
  const [x, y, z, radius] = [0, 1, 2, 3].map((k) => sphere[k])
  const projected = projectedError(
    error,
    x,
    y,
    z,
    radius,
    f.views[w],
    f.stretches[w],
    f.focal,
    f.near,
    f.perspective,
  )
  return projected <= f.pixelError
}

/**
 * The kernel's verdict on a group's draw distances (`outsideGroupDrawDistance`): whether no
 * placement of the box `low`–`high`, from the eye, can lie within `near` and `far` — the box's
 * centre's distance, nearer or farther by twice the half diagonal: a point of the box and the
 * sphere of a placement about it, which the clamp of `drawSphereRadius` holds within the half
 * diagonal of its own box. The nearest is taken at the smaller of the two `scales` (the instances'
 * and the objects' of their own), the farthest at the larger. A `far` of 0 or less names none, and
 * so do distances that leave nothing between them. A cut in one pass (`twoPass` false) tests none.
 */
export function outsideGroupDrawDistance(
  near: number,
  far: number,
  low: ArrayLike<number>,
  high: ArrayLike<number>,
  scales: readonly [number, number] = [1, 1],
  twoPass = true,
) {
  if (!(far > 0) || !twoPass || near >= far) return false
  const centre = [0, 1, 2].map((a) => 0.5 * (low[a] + high[a])),
    slack = Math.hypot(...[0, 1, 2].map((a) => high[a] - low[a]))
  const away = Math.hypot(...centre)
  return (
    outsideDrawDistances(away, slack, 0, far, Math.max(...scales)) ||
    outsideDrawDistances(away, slack, near, 0, Math.min(...scales))
  )
}

/** The distances a placement is drawn at, or a group's, as the words that hold them name them
 *  (`DRAW_NEAR_WORD`, `TREE_DRAW_NEAR`; an object's `min` and `max`): the nearest and the farthest,
 *  the farthest 0 for none. */
export type DrawDistances = { near: number; far: number }

/**
 * The refit's draw distances of a group over its placements' (`fitGroup`,
 * `../tree/treeRefitWgsl.ts`): the nearest of their nearest and the farthest of their farthest;
 * both 0 as soon as one placement names none — it is drawn at every distance — or when there is
 * none.
 */
export function fitDrawDistances(members: readonly DrawDistances[]): DrawDistances {
  if (!members.length || members.some((member) => !(member.far > 0))) return { near: 0, far: 0 }
  return {
    near: Math.min(...members.map((member) => member.near)),
    far: Math.max(...members.map((member) => member.far)),
  }
}
