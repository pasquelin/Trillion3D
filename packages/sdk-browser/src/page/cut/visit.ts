import { frustumClipBox } from '../../../../sdk-core/src/index.ts';
import { frameClusterError } from '../selection/frame.ts';
import { joue } from '../../math/batchLot.ts';
import { selectionScratch, type PageRecord, type SelectionState } from './state.ts';
import { BOUND_STRIDE } from './bounds.ts';
import { subtreeDecision } from './node.ts';
import { take } from './take.ts';
import { CUT_WALK, cutLeaves, cutWalkModule, walkCut, type WalkCulling } from './walkWasm.ts';

/** The JavaScript descent: node tests and pages interleaved, the reference of `walkCut`. */
function descend<T extends PageRecord>(s: SelectionState<T>, pages: T[], culling?: WalkCulling) {
  const exact = s.flatExact,
    cones = s.flatCones,
    boxes = s.flatBoxes,
    open = s.flatOpen;
  if (!culling) {
    for (let i = 0; i < pages.length; i++) take(s, pages, i, false, false, exact, cones, boxes);
    return;
  }
  const { nodes, stride, bounds } = culling;
  const { stack, planes } = selectionScratch;
  let top = 0;
  stack[top++] = 0;
  while (top > 0) {
    const entry = stack[--top];
    const node = entry >> 2;
    const base = node * stride;
    let inside = (entry & 1) === 1;
    let settled = (entry & 2) === 2;
    // A node already settled and entirely inside the frustum is not tested: it is only traversed.
    if (!inside || !settled) s.nodesTested++;
    if (!inside) {
      const clipped = frustumClipBox(
        planes,
        nodes[base],
        nodes[base + 1],
        nodes[base + 2],
        nodes[base + 3],
        nodes[base + 4],
        nodes[base + 5],
      );
      if (clipped === 0) {
        s.frustumRejected++;
        continue;
      }
      inside = clipped === 2;
    }
    if (!settled) {
      // Rejection the manifest already carries: no replacement still coarse enough in the subtree.
      // At a zero threshold the parent ceiling drops under the threshold only if it is zero: same identity
      // as `pixelsAtZero`, and not one extra projection.
      const bound = nodes[base + 10];
      if (
        exact
          ? bound === 0
          : bound >= 0 && frameClusterError(s, bound, nodes, base + 6) <= s.pixelError
      )
        continue;
      const decision = subtreeDecision(s, bounds, node * BOUND_STRIDE, exact);
      // Under the cut rule (`./rule.ts`) a cluster above the threshold is still drawn when its
      // finer group is not resident: a subtree holding one (`open`, `./readiness.ts`) is never
      // rejected on its floor, and its descent decides cluster by cluster.
      if (decision < 0 && !(open && open[node] > 0)) continue;
      settled = decision > 0;
    }
    const children = nodes[base + 12];
    if (children > 0) {
      const first = nodes[base + 11];
      if (top + children > stack.length) throw new Error('Culling stack too small');
      const flag = (inside ? 1 : 0) | (settled ? 2 : 0);
      for (let child = 0; child < children; child++) stack[top++] = ((first + child) << 2) | flag;
      continue;
    }
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14];
    for (let i = 0; i < pageCount; i++)
      take(s, pages, firstPage + i, settled, inside, exact, cones, boxes);
  }
}

/** The pages of the `count` leaves `walkCut` wrote, taken in the order the descent takes them. */
function takeLeaves<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  culling: WalkCulling,
  count: number,
) {
  const { nodes, stride } = culling,
    leaves = cutLeaves(),
    exact = s.flatExact,
    cones = s.flatCones,
    boxes = s.flatBoxes;
  for (let i = 0; i < count; i++) {
    const entry = leaves[i],
      base = (entry >>> 2) * stride,
      inside = (entry & 1) === 1,
      settled = (entry & 2) === 2;
    const firstPage = nodes[base + 13],
      pageCount = nodes[base + 14];
    for (let p = 0; p < pageCount; p++)
      take(s, pages, firstPage + p, settled, inside, exact, cones, boxes);
  }
}

/**
 * The cut's descent over one root. When the SDK module carries the kernel, the path governor
 * (`batchLot.ts::joue`) plays either the module's node walk then the leaves' pages, or the
 * JavaScript descent: both take the same pages in the same order.
 */
export function traverse<T extends PageRecord>(
  s: SelectionState<T>,
  pages: T[],
  culling?: WalkCulling,
) {
  const wasm = culling ? cutWalkModule() : null;
  if (!wasm || !culling) return descend(s, pages, culling);
  joue(
    CUT_WALK,
    culling.nodes.length / culling.stride,
    () => {
      const count = walkCut(wasm, s, culling);
      if (count < 0) descend(s, pages, culling);
      else takeLeaves(s, pages, culling, count);
    },
    () => descend(s, pages, culling),
  );
}
