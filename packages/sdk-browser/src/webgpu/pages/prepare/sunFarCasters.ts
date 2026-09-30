import { preparedNodeRank } from '../../../host/prepared/sourceRanks.ts';
import { isDrawnNode } from '../../../host/graph/kinds.ts';
import type { GpuBounceProxy } from '../../../bounce/proxy.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

/** Each ranked source node and the meshes it draws itself, indexed once per runtime. */
const indexes = new WeakMap<WebgpuPagesRuntime, Map<number, Object3D>>();

const drawnOf = new WeakMap<WebgpuPagesRuntime, Map<number, Object3D[]>>();

/** Source identity is indexed once. */
export function sourceNodes(rt: WebgpuPagesRuntime) {
  let nodes = indexes.get(rt);
  if (nodes) return nodes;
  nodes = new Map<number, Object3D>();
  rt.setup.source.traverse((node) => {
    const rank = preparedNodeRank(node);
    if (rank !== undefined) nodes.set(rank, node);
  });
  indexes.set(rt, nodes);
  return nodes;
}

/** The meshes each ranked source node draws: itself, or the parts under it no other rank carries. */
function drawnMeshes(rt: WebgpuPagesRuntime) {
  let drawn = drawnOf.get(rt);
  if (drawn) return drawn;
  drawn = new Map<number, Object3D[]>();
  for (const [rank, node] of sourceNodes(rt)) {
    const parts: Object3D[] = [];
    const walk = (part: Object3D) => {
      if (isDrawnNode(part)) parts.push(part);
      for (const child of part.children) if (preparedNodeRank(child) === undefined) walk(child);
    };
    walk(node);
    if (parts.length) drawn.set(rank, parts);
  }
  drawnOf.set(rt, drawn);
  return drawn;
}

/** Each proxy's last read: the scene revision, and the source nodes that cast none then. */
const casts = new WeakMap<GpuBounceProxy, { epoch: number; none: ReadonlySet<number> }>();

/**
 * The far sun's proxy lets through the triangles whose every owner casts no shadow (#966): a
 * source node casts none when each mesh it draws says `castShadow = false`; one the host does not
 * hold casts. The flags are read once per scene revision, as the shadow cut reads each mesh's
 * (`placement/hidden.ts`), and the proxy is marked again only when one changed.
 */
export function syncSunFarCasters(rt: WebgpuPagesRuntime) {
  const proxy = rt.sunFar.gpu?.proxy,
    epoch = rt.run.gate.revisions.scene;
  const last = proxy && casts.get(proxy);
  if (!proxy || last?.epoch === epoch) return;
  const none = new Set<number>();
  let same = true;
  for (const [rank, parts] of drawnMeshes(rt))
    if (parts.every((part) => !part.castShadow)) {
      none.add(rank);
      same &&= !!last?.none.has(rank);
    }
  casts.set(proxy, { epoch, none });
  if (same && none.size === (last?.none.size ?? 0)) return;
  proxy.castless((source) => none.has(source));
}
