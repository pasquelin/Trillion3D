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
 * an invisible wall is a level designer's tool. A mesh that moves afterwards is not followed:
 * the tree is rebuilt on demand. Compiled models, whose triangles live in GPU pages, are not
 * read; a level made of them gives a simple mesh stand-in to collide with.
 *
 * COST. One pass over the triangles to place them, then the tree build, `O(T log T)`; the
 * tree keeps about 52 bytes per triangle (`triangleTree.ts`).
 */
export function meshCollision(roots: Object3D | readonly Object3D[]) {
  const list = (Array.isArray(roots) ? roots : [roots]) as readonly Object3D[];
  const chunks: Float32Array[] = [];
  let total = 0;
  for (const root of list) {
    root.updateWorldMatrix(true, true);
    root.traverse((node) => {
      const chunk = meshTriangles(node as Mesh);
      if (!chunk) return;
      chunks.push(chunk);
      total += chunk.length;
    });
  }
  const all = new Float32Array(total);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.length;
  }
  return triangleCollision(buildTriangleTree(all));
}

const corner = new Float64Array(3);

/** One mesh's triangles in world space, nine numbers each; `null` for anything else. */
function meshTriangles(node: Mesh) {
  if (!node.isMesh || node.primitive !== 'triangles') return null;
  const position = node.geometry.attributes.position,
    index = node.geometry.index;
  if (!position) return null;
  const corners = index ? index.count : position.count,
    count = Math.floor(corners / 3);
  const out = new Float32Array(count * 9),
    matrix = node.matrixWorld.elements,
    { array, itemSize } = position;
  for (let i = 0; i < count * 3; i++) {
    const vertex = index ? index.array[i] : i,
      from = vertex * itemSize;
    transformAffinePoint(corner, matrix, array[from], array[from + 1], array[from + 2]);
    out.set(corner, 3 * i);
  }
  return out;
}
