import { transformAffinePoint } from '../math/primitives/vector.ts';
import type { Object3D } from '../world/object/object3d.ts';
import type { Mesh } from '../world/object/mesh.ts';
import { buildTriangleTree } from './triangleTree.ts';
import { triangleCollision } from './characterCollision.ts';

/**
 * THE COLLISION WORLD OF A SCENE: every triangle of the meshes under `roots`, placed in world
 * space as their world matrices stand now, gathered into one static triangle tree: the default
 * `CharacterCollision`.
 *
 * Only drawn triangles collide: a mesh whose `primitive` is not `'triangles'` (points, lines,
 * sprites) is skipped, and so is anything without a position list. Invisible meshes collide —
 * an invisible wall is a level designer's tool —, the nodes `skip` names do not (the `helper`
 * marks, `forEachReadNode`). A mesh that moves afterwards is not followed: the tree is rebuilt
 * on demand. Compiled models, whose triangles live in GPU pages, are not
 * read; a level made of them gives a simple mesh stand-in to collide with.
 *
 * COST. One pass over the triangles to place them, then the tree build, `O(T log T)`; the
 * tree keeps about 52 bytes per triangle (`triangleTree.ts`).
 */
export function meshCollision(
  roots: Object3D | readonly Object3D[],
  skip: (node: Object3D) => boolean = () => false,
) {
  const chunks: Float32Array[] = [];
  let total = 0;
  for (const root of Array.isArray(roots) ? roots : [roots]) root.updateWorldMatrix(true, true);
  forEachReadNode(roots, { skip }, (node) => {
    const chunk = meshTriangles(node as Mesh, node.matrixWorld.elements);
    if (!chunk) return;
    chunks.push(chunk);
    total += chunk.length;
  });
  const all = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return triangleCollision(buildTriangleTree(all));
}

/**
 * THE ONE RULE OF WHAT A SCENE QUERY READS — a collision world, a raycast: `visit` is called on
 * every node under `roots`, parents first, except the nodes `skip` names — the marks a page works
 * with, never its content — and, when `visibleOnly`, the hidden ones, each with its subtree. A
 * root under a skipped or, when `visibleOnly`, a hidden ancestor is read as its ancestors are.
 */
export function forEachReadNode(
  roots: Object3D | readonly Object3D[],
  rule: { skip?: (node: Object3D) => boolean; visibleOnly?: boolean },
  visit: (node: Object3D) => void,
) {
  const { skip = () => false, visibleOnly = false } = rule;
  const read = (node: Object3D) => !skip(node) && (!visibleOnly || node.visible);
  const walk = (node: Object3D) => {
    if (!read(node)) return;
    visit(node);
    for (const child of node.children) walk(child);
  };
  const list = (Array.isArray(roots) ? roots : [roots]) as readonly Object3D[];
  for (const root of list) {
    let shown = true;
    for (let at = root.parent; at && shown; at = at.parent) shown = read(at);
    if (shown) walk(root);
  }
}

const corner = new Float64Array(3);

/** One mesh's triangles, nine numbers each, moved by the column-major `matrix` — its world matrix
 *  for a collision world — or as they are stored when it is `null`; `null` for anything but a
 *  triangle mesh with a position list. */
export function meshTriangles(node: Mesh, matrix: ArrayLike<number> | null) {
  if (!node.isMesh || node.primitive !== 'triangles') return null;
  const position = node.geometry.attributes.position,
    index = node.geometry.index;
  if (!position) return null;
  const corners = index ? index.count : position.count,
    count = Math.floor(corners / 3);
  const out = new Float32Array(count * 9),
    { array, itemSize } = position;
  for (let i = 0; i < count * 3; i++) {
    const vertex = index ? index.array[i] : i,
      from = vertex * itemSize;
    if (matrix) {
      transformAffinePoint(corner, matrix, array[from], array[from + 1], array[from + 2]);
      out.set(corner, 3 * i);
    } else for (let k = 0; k < 3; k++) out[3 * i + k] = array[from + k];
  }
  return out;
}
