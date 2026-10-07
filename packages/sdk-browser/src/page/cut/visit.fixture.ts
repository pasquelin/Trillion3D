import { frustumClipBox } from '../../../../sdk-core/src/index.ts'
import { cullingBoundsFor } from '../../gpu/dag/packNodes.ts'
import { frameClusterError } from '../selection/frame.fixture.ts'
import { selectionScratch, type PageRecord, type SelectionState } from './state.fixture.ts'
import { BOUND_STRIDE } from './bounds.ts'
import { subtreeRejected } from './node.fixture.ts'
import { take } from './take.fixture.ts'

/** What the descent reads of a root's culling: the primitive's nodes, and the bounds the host
 *  derived from its pages, derived here as the GPU cut's layout does when it carries none. */
type WalkCulling = { nodes: Float64Array; stride: number; bounds?: Float64Array }

/** Bounds derived once per node array: a placement copies the envelope, never the pages. */
const derived = new Map<Float64Array, Float64Array>()

/** The cut's descent over one root: node tests and pages interleaved. */
export function traverse<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  culling?: WalkCulling,
) {
  const cones = s.flatCones,
    boxes = s.flatBoxes
  if (!culling) {
    for (let i = 0; i < pages.length; i++) take(s, pages, i, false, cones, boxes)
    return
  }
  const { nodes, stride } = culling,
    bounds = cullingBoundsFor(culling, pages, derived)
  const { stack, planes } = selectionScratch
  let top = 0
  stack[top++] = 0
  while (top > 0) {
    const entry = stack[--top]
    const node = entry >> 1
    const base = node * stride
    let inside = (entry & 1) === 1
    s.nodesTested++
    if (!inside) {
      const clipped = frustumClipBox(
        planes,
        nodes[base],
        nodes[base + 1],
        nodes[base + 2],
        nodes[base + 3],
        nodes[base + 4],
        nodes[base + 5],
      )
      if (clipped === 0) {
        s.frustumRejected++
        continue
      }
      inside = clipped === 2
    }
    if (nodeRejected(s, nodes, base, bounds, node)) continue
    const children = nodes[base + 12]
    if (children > 0) {
      const first = nodes[base + 11]
      if (top + children > stack.length) throw new Error('Culling stack too small')
      const flag = inside ? 1 : 0
      for (let child = 0; child < children; child++) stack[top++] = ((first + child) << 1) | flag
      continue
    }
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14]
    for (let i = 0; i < pageCount; i++) take(s, pages, firstPage + i, inside, cones, boxes)
  }
}

/** True when node `node`, at `base` of `nodes`, gives the cut nothing: no replacement in its
 *  subtree is still too coarse (the manifest's bound), or no cluster is fine enough (its floor). */
function nodeRejected<T extends PageRecord>(
  s: SelectionState<T>,
  nodes: Float64Array,
  base: number,
  bounds: Float64Array,
  node: number,
) {
  const bound = nodes[base + 10]
  if (
    !(s.flatReach > 0) &&
    bound >= 0 &&
    frameClusterError(s, bound, nodes, base + 6) <= s.pixelError
  )
    return true
  // Under the cut rule (`./rule.ts`) a cluster above the threshold is still drawn when its
  // finer group is not resident: a subtree holding one (`open`, `./readiness.ts`) is never
  // rejected on its floor, and its descent decides cluster by cluster.
  const held = s.flatHeld
  return subtreeRejected(s, bounds, node * BOUND_STRIDE) && !(held && held.openAt(node) > 0)
}
