// The kernel's verdict on a cut node and its floor, in JavaScript over the frames of `math.fixture.ts`.
import { frustumExcludesBox } from '../../../../../math/src/geometry/frustum/box.ts'
import { viewDepthOf } from '../../selection/projection.ts'
import { errorFloorAt } from '../../selection/projection.fixture.ts'
import { DAG_NODE_FLOATS } from '../types.ts'
import {
  NODE_CEIL,
  NODE_CHILD_COUNT,
  NODE_FLOOR,
  NODE_MAX,
  NODE_MIN,
  NODE_OPEN,
  NODE_SPHERE,
} from '../nodeLayout.ts'
import { projectedError, type DagViewFrames } from './math.fixture.ts'
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
  return ints[base + NODE_CHILD_COUNT]
}
