import { frustumClipBox } from '../../../../sdk-core/src/index.ts'
import { frameClusterError } from '../selection/frame.fixture.ts'
import { selectionScratch, type PageRecord, type SelectionState } from './state.fixture.ts'
import { SUBTREE_STRIDE, subtreeBoundsOf } from './bounds.fixture.ts'
import { subtreeDecision } from './node.fixture.ts'
import { take } from './take.fixture.ts'

/** What the descent reads of a root's culling: the primitive's nodes, whose bounds it derives
 *  from the pages (`./bounds.fixture.ts`). */
type WalkCulling = { nodes: Float64Array; stride: number }

/** The cut's descent over one root: node tests and pages interleaved. */
export function traverse<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  culling?: WalkCulling,
) {
  const exact = s.flatExact,
    cones = s.flatCones,
    boxes = s.flatBoxes,
    held = s.flatHeld
  if (!culling) {
    for (let i = 0; i < pages.length; i++) take(s, pages, i, false, false, exact, cones, boxes)
    return
  }
  const { nodes, stride } = culling,
    bounds = subtreeBoundsOf(culling, pages)
  const { stack, planes } = selectionScratch
  let top = 0
  stack[top++] = 0
  while (top > 0) {
    const entry = stack[--top]
    const node = entry >> 2
    const base = node * stride
    let inside = (entry & 1) === 1
    let settled = (entry & 2) === 2
    // A node already settled and entirely inside the frustum is not tested: it is only traversed.
    if (!inside || !settled) s.nodesTested++
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
    if (!settled) {
      // Rejection the manifest already carries: no replacement still coarse enough in the subtree.
      // At a zero threshold the parent ceiling drops under the threshold only if it is zero: same identity
      // as `pixelsAtZero`, and not one extra projection.
      const bound = nodes[base + 10]
      if (
        !(s.flatReach > 0) &&
        (exact
          ? bound === 0
          : bound >= 0 && frameClusterError(s, bound, nodes, base + 6) <= s.pixelError)
      )
        continue
      const decision = subtreeDecision(s, bounds, node * SUBTREE_STRIDE, exact)
      // Under the cut rule (`./rule.ts`) a cluster above the threshold is still drawn when its
      // finer group is not resident: a subtree holding one (`open`, `./readiness.ts`) is never
      // rejected on its floor, and its descent decides cluster by cluster.
      if (decision < 0 && !(held && held.openAt(node) > 0)) continue
      settled = decision > 0
    }
    const children = nodes[base + 12]
    if (children > 0) {
      const first = nodes[base + 11]
      if (top + children > stack.length) throw new Error('Culling stack too small')
      const flag = (inside ? 1 : 0) | (settled ? 2 : 0)
      for (let child = 0; child < children; child++) stack[top++] = ((first + child) << 2) | flag
      continue
    }
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14]
    for (let i = 0; i < pageCount; i++)
      take(s, pages, firstPage + i, settled, inside, exact, cones, boxes)
  }
}
