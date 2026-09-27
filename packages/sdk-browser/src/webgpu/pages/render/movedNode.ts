import type { ClusterRoot } from '../../../page/selection/types.ts';
import type { PageRec } from '../../../page/selection/selection.ts';
import { objectEdits } from '../../../../../sdk-core/src/world/object/objectEdits.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

/**
 * What a move finds before it writes anything: the named node, and the selection roots under it.
 *
 * Both answers used to cost the whole scene per call — a walk of the source for the name, and a
 * climb of every root's parent chain for the roots — so moving one object in a world of fifty
 * thousand nodes cost milliseconds. Each is now an index built once and checked before use: the
 * answers stay those of the walks (#915).
 */

/** Name → the first node of `source` in prefix order that bears it, and the edit count it was
 *  built under: while no object was renamed or reparented (`objectEdits`), the walk answers the
 *  same, ambiguous names included. */
const nameIndexes = new WeakMap<Object3D, { edits: number; names: Map<string, Object3D> }>();

function buildNameIndex(source: Object3D) {
  const names = new Map<string, Object3D>();
  source.traverse((node) => void (names.has(node.name) || names.set(node.name, node)));
  const index = { edits: objectEdits(), names };
  nameIndexes.set(source, index);
  return index;
}

/**
 * The named node of the prepared scene, or `undefined`: the first node of `source`, in prefix
 * order, that bears `nodeName` — the walk's answer. The index is dropped whenever a name or a
 * parent changed anywhere since it was built, a node added, renamed or freed included.
 */
export function findNode(source: Object3D, nodeName: string) {
  let index = nameIndexes.get(source);
  if (index?.edits !== objectEdits()) index = buildNameIndex(source);
  return index.names.get(nodeName);
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
