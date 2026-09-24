import type { HostNode } from '../host/resources.ts';
import type { ClusterRoot } from '../page/selection/types.ts';
import { rowParked } from './rows.ts';

/** True when `node` and every node above it are visible. */
function shownChain(node: HostNode) {
  for (let walk: HostNode | null = node; walk; walk = walk.parent) if (!walk.visible) return false;
  return true;
}

/**
 * Brings the roots level with the visibility the host wrote on the source graph: a root whose
 * source node, or one of its ancestors, is hidden is parked as a parked row is — every cut skips
 * it, its tables stay —, and taken back once shown again, unless its row is parked. `park` hears
 * the rank of each root that flipped. Read once per scene revision, never per frame: the source
 * nodes' chains are walked, the last one's verdict reused by the roots that share it.
 */
export function followHostVisibility<T extends { sourceMesh?: HostNode }>(
  roots: readonly ClusterRoot<T>[],
  park?: (rank: number, parked: boolean) => void,
) {
  let last: HostNode | undefined,
    lastHidden = false;
  for (let rank = 0; rank < roots.length; rank++) {
    const root = roots[rank],
      source = root.pages[0]?.sourceMesh;
    if (!source) continue;
    if (source !== last) {
      last = source;
      lastHidden = !shownChain(source);
    }
    if (lastHidden === !!root.hidden) continue;
    root.hidden = lastHidden;
    const parked = lastHidden || rowParked(root.placement);
    if (parked === !!root.parked) continue;
    root.parked = parked;
    park?.(rank, parked);
  }
}
