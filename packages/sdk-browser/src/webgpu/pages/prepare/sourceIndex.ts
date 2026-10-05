import { preparedNodeRank } from '../../../host/prepared/sourceRanks.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

const indexes = new WeakMap<WebgpuPagesRuntime, Map<number, Object3D>>();

/** Each ranked source node, indexed once per runtime. */
export function sourceNodes(rt: WebgpuPagesRuntime) {
  let nodes = indexes.get(rt);
  if (nodes) return nodes;
  const found = new Map<number, Object3D>();
  rt.setup.source.traverse((node) => {
    const rank = preparedNodeRank(node);
    if (rank !== undefined) found.set(rank, node);
  });
  indexes.set(rt, (nodes = found));
  return nodes;
}
