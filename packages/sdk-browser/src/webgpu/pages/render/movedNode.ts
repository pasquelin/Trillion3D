import type { ClusterRoot } from '../../../page/selection/types.ts';
import type { PageRec } from '../../../page/selection/selection.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

/**
 * What a move finds before it writes anything: the named node, and the selection roots under it.
 *
 * Both answers used to cost the whole scene per call — a walk of the source for the name, and a
 * climb of every root's parent chain for the roots — so moving one object in a world of fifty
 * thousand nodes cost milliseconds. Each is now an index built once and checked before use: the
 * answers stay those of the walks (#915).
 */

/** The first node of `source`, in prefix order, that bears `nodeName`: the reference walk. */
function walkForNode(source: Object3D, nodeName: string) {
  let found: Object3D | undefined;
  source.traverse((node) => {
    if (!found && node.name === nodeName) found = node;
  });
  return found;
}

/** Name → node of each prepared source, built by one walk. `null` marks a name two nodes bore
 *  at build time: the walk decides it every time, exactly as the reference does. */
const nameIndexes = new WeakMap<Object3D, Map<string, Object3D | null>>();

function buildNameIndex(source: Object3D) {
  const index = new Map<string, Object3D | null>();
  source.traverse((node) => void index.set(node.name, index.has(node.name) ? null : node));
  nameIndexes.set(source, index);
  return index;
}

/** True when `node` is `source` or lies below it, read on the live parent chain. */
function isUnder(node: Object3D, source: Object3D) {
  for (let walk: Object3D | null = node; walk; walk = walk.parent) if (walk === source) return true;
  return false;
}

/**
 * The named node of the prepared scene, or `undefined`. A hit is checked before use — still so
 * named, still under the source — and a failed check rebuilds the index. A name the index does
 * not hold, or holds as ambiguous, takes the reference walk, which also sees a node added since
 * the build; finding one there rebuilds the index. What no check sees is a node added or renamed
 * after the build that takes, ahead of the indexed one in walk order, a name only that one bore.
 */
export function findNode(source: Object3D, nodeName: string) {
  let index = nameIndexes.get(source) ?? buildNameIndex(source);
  let hit = index.get(nodeName);
  if (hit && (hit.name !== nodeName || !isUnder(hit, source))) {
    index = buildNameIndex(source);
    hit = index.get(nodeName);
  }
  if (hit) return hit;
  const found = walkForNode(source, nodeName);
  if (found && hit === undefined) buildNameIndex(source);
  return found;
}

type Roots = readonly ClusterRoot<PageRec>[];

/** Selection-root ranks by source mesh, built once per root list: the layout never edits it. */
const rootsByMeshOf = new WeakMap<Roots, Map<Object3D, number[]>>();

function rootsByMesh(roots: Roots) {
  let map = rootsByMeshOf.get(roots);
  if (map) return map;
  map = new Map();
  for (let i = 0; i < roots.length; i++) {
    const mesh = roots[i].pages[0]?.sourceMesh as Object3D | undefined;
    if (!mesh) continue;
    const list = map.get(mesh);
    if (list) list.push(i);
    else map.set(mesh, [i]);
  }
  rootsByMeshOf.set(roots, map);
  return map;
}

/**
 * Ranks of the roots whose source mesh is `node` or lies below it, increasing — the order a loop
 * over every root visits them — written into `out`, which is returned. The node's LIVE subtree is
 * walked once: the same relation as climbing each root's parent chain up to the node.
 */
export function rootsUnder(roots: Roots, node: Object3D, out: number[]) {
  const byMesh = rootsByMesh(roots);
  out.length = 0;
  node.traverse((walk) => {
    const list = byMesh.get(walk);
    if (list) for (const i of list) out.push(i);
  });
  return out.sort((a, b) => a - b);
}
