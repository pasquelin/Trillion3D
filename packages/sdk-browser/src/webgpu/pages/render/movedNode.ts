import type { ClusterRoot } from '../../../page/selection/types.ts';
import type { PageRec } from '../../../page/selection/selection.ts';
import { objectEdits } from '../../../../../sdk-core/src/scene/core/nodeEdits.ts';
import type { Object3D } from '../../../../../sdk-core/src/world/object/object3d.ts';

/** Name → the first node of a prepared source, in prefix order, that bears it, and the edit count
 *  it was built under (`objectEdits`): the walk's answer while no name or parent changed. A
 *  plain `traverse`, not `getObjectByName`, which a loaded model answers from its own file graph. */
const nameIndexes = new WeakMap<Object3D, { edits: number; names: Map<string, Object3D> }>();

/** The named node of the prepared scene, or `undefined`, by the index, rebuilt by one walk when
 *  anything was renamed, added, removed or freed since (#915). */
export function findNode(source: Object3D, nodeName: string) {
  const edits = objectEdits();
  let index = nameIndexes.get(source);
  if (index?.edits !== edits) {
    const names = new Map<string, Object3D>();
    source.traverse((node) => void (names.has(node.name) || names.set(node.name, node)));
    nameIndexes.set(source, (index = { edits, names }));
  }
  return index.names.get(nodeName);
}

const ascending = (a: number, b: number) => a - b;

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
  walking = rootsByMesh(roots);
  found = out;
  out.length = 0;
  node.traverse(collect);
  return out.sort(ascending);
}

// The walk's state and its one callback, declared once: a move allocates no closure.
let walking = new Map<Object3D, number[]>(),
  found: number[] = [];
const collect = (walk: Object3D) => {
  const list = walking.get(walk);
  if (list) for (const i of list) found.push(i);
};
