// The kernel's verdict on a cut node and its floor, in JavaScript over the frames of `math.fixture.ts`.
import { frustumExcludesBox } from '../../../../../sdk-core/src/index.ts'
import { viewDepthOf } from '../../../page/selection/projection.ts'
import { errorFloorAt } from '../../../page/selection/projection.fixture.ts'
import { DAG_NODE_FLOATS } from '../types.ts'
import {
  NODE_CEIL,
  NODE_CHILD_COUNT,
  NODE_FLOOR,
  NODE_FLOOR_SPHERE,
  NODE_MAX,
  NODE_MIN,
  NODE_OPEN,
  NODE_SPHERE,
  NODE_WORLD,
} from '../nodeLayout.ts'
import { projectedError, thresholdOf, type DagViewFrames } from './math.fixture.ts'

/** Kernel verdict on a cut node (`../shader/levelWgsl.ts`, `levelStep`): `-1` rejected —
 *  outside the trunk, or whose subtree replacement is not yet too coarse —, otherwise
 *  the number of children it opens, `0` meaning a kept leaf. */
export function dagNodeVerdict(
  f: DagViewFrames,
  nodes: ArrayLike<number>,
  ints: Uint32Array,
  n: number,
) {
  const base = n * DAG_NODE_FLOATS,
    w = ints[base + NODE_WORLD]
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
  const ceil = nodes[base + NODE_CEIL]
  if (
    ceil >= 0 &&
    projectedError(
      ceil,
      nodes[base + NODE_SPHERE],
      nodes[base + NODE_SPHERE + 1],
      nodes[base + NODE_SPHERE + 2],
      nodes[base + NODE_SPHERE + 3],
      f.views[w],
      f.stretches[w],
      f.focal,
      f.near,
      f.perspective,
    ) <= thresholdOf(f, w)
  )
    return -1
  return ints[base + NODE_CHILD_COUNT]
}

/**
 * The subtree error FLOOR, projected as the kernel projects it (`../shader/floorWgsl.ts`,
 * `errorFloor`): above the threshold none of its clusters is fine enough and the cut
 * takes none. An open subtree — it holds a cluster whose finer group is not resident, which the
 * cut rule may draw whatever its error — returns zero, so never prunes.
 */
export function dagNodeFloor(
  f: DagViewFrames,
  nodes: ArrayLike<number>,
  ints: Uint32Array,
  n: number,
) {
  const base = n * DAG_NODE_FLOATS,
    w = ints[base + NODE_WORLD]
  if (ints[base + NODE_OPEN] !== 0) return 0
  return errorFloorAt(
    nodes[base + NODE_FLOOR],
    viewDepthOf(
      nodes[base + NODE_FLOOR_SPHERE],
      nodes[base + NODE_FLOOR_SPHERE + 1],
      nodes[base + NODE_FLOOR_SPHERE + 2],
      f.views[w],
    ),
    nodes[base + NODE_FLOOR_SPHERE + 3],
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
