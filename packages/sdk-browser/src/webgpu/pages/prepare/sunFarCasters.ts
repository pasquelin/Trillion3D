import { placedMeshRank, preparedNodeRank } from '../../../host/prepared/sourceRanks.ts';
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

/** The host meshes each mesh rank a partition's cells place is drawn by (`placed.ts`). */
const placedOf = new WeakMap<WebgpuPagesRuntime, Map<number, Object3D[]>>();

function placedParts(rt: WebgpuPagesRuntime) {
  let placed = placedOf.get(rt);
  if (placed) return placed;
  placed = new Map<number, Object3D[]>();
  rt.setup.source.traverse((part) => {
    const rank = placedMeshRank(part);
    if (rank !== undefined) placed.set(rank, [...(placed.get(rank) ?? []), part]);
  });
  placedOf.set(rt, placed);
  return placed;
}

/** The keys whose every mesh says `castShadow = false`. */
const castingNone = (meshes: Map<number, Object3D[]>) =>
  new Set(
    [...meshes].filter(([, parts]) => parts.every((part) => !part.castShadow)).map(([k]) => k),
  );
const sameSet = (a: ReadonlySet<number>, b: ReadonlySet<number> = new Set()) =>
  a.size === b.size && [...a].every((key) => b.has(key));

/** Each proxy's last read: the scene revision, the source nodes and the placed meshes that cast
 *  none then. */
const casts = new WeakMap<
  GpuBounceProxy,
  { epoch: number; none: ReadonlySet<number>; meshes: ReadonlySet<number> }
>();

/**
 * The far sun's proxy lets through the triangles whose every owner casts no shadow (#966): a
 * source node casts none when each mesh it draws says `castShadow = false`; one the host does not
 * hold — a partition's cell node, loaded or not — when each host mesh its placed mesh is drawn by
 * says so, as its rows do (`scene/partition/follow.ts`). The flags are read once per scene
 * revision, as the shadow cut reads each mesh's (`placement/hidden.ts`), and the proxy is marked
 * again only when one changed.
 */
export function syncSunFarCasters(rt: WebgpuPagesRuntime) {
  const proxy = rt.sunFar.gpu?.proxy,
    epoch = rt.run.gate.revisions.scene;
  const last = proxy && casts.get(proxy);
  if (!proxy || last?.epoch === epoch) return;
  const none = castingNone(drawnMeshes(rt)),
    meshes = castingNone(placedParts(rt));
  casts.set(proxy, { epoch, none, meshes });
  if (sameSet(none, last?.none) && sameSet(meshes, last?.meshes)) return;
  const held = sourceNodes(rt);
  proxy.castless((source, mesh) => none.has(source) || (!held.has(source) && meshes.has(mesh)));
}
