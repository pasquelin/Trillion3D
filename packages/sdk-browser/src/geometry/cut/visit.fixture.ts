import { frustumClipBox } from '../../../../math/src/geometry/frustum/box.ts'
import { frameClusterError } from '../selection/frame.fixture.ts'
import {
  CULL_CEIL,
  CULL_CHILD_COUNT,
  CULL_FIRST_CHILD,
  CULL_FIRST_PAGE,
  CULL_PAGE_COUNT,
  CULL_SPHERE,
} from '../dag/types.ts'
import { selectionScratch, type PageRecord, type SelectionState } from './state.fixture.ts'
import { subtreeRejected } from './node.fixture.ts'
import { take } from './take.fixture.ts'

/** What the descent reads of a root's culling: the primitive's nodes. */
type WalkCulling = { nodes: Float64Array; stride: number }

/** The cut's descent over one root: node tests and pages interleaved. */
export function traverse<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  culling?: WalkCulling,
) {
  const boxes = s.flatBoxes
  if (!culling) {
    for (let i = 0; i < pages.length; i++) take(s, pages, i, false, boxes)
    return
  }
  const { nodes, stride } = culling
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
    if (nodeRejected(s, nodes, base, node)) continue
    const children = nodes[base + CULL_CHILD_COUNT]
    if (children > 0) {
      const first = nodes[base + CULL_FIRST_CHILD]
      if (top + children > stack.length) throw new Error('Culling stack too small')
      const flag = inside ? 1 : 0
      for (let child = 0; child < children; child++) stack[top++] = ((first + child) << 1) | flag
      continue
    }
    const firstPage = nodes[base + CULL_FIRST_PAGE],
      pageCount = nodes[base + CULL_PAGE_COUNT]
    for (let i = 0; i < pageCount; i++) take(s, pages, firstPage + i, inside, boxes)
  }
}

/** True when node `node`, at `base` of `nodes`, gives the cut nothing: no replacement in its
 *  subtree is still too coarse (its ceiling), or, a leaf, no cluster of it is fine enough (its
 *  floor). */
function nodeRejected<T extends PageRecord>(
  s: SelectionState<T>,
  nodes: Float64Array,
  base: number,
  node: number,
) {
  const bound = nodes[base + CULL_CEIL]
  if (bound >= 0 && frameClusterError(s, bound, nodes, base + CULL_SPHERE) <= s.pixelError)
    return true
  if (nodes[base + CULL_CHILD_COUNT] > 0) return false
  // Under the cut rule (`./rule.ts`) a cluster above the threshold is still drawn when its
  // finer group is not resident: a leaf holding one (`open`, `./readiness.ts`) is never
  // rejected on its floor, and its pages are decided cluster by cluster.
  const held = s.flatHeld
  return subtreeRejected(s, nodes, base) && !(held && held.openAt(node) > 0)
}
