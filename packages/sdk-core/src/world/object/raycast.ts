import type { Object3D } from './object3d.ts';
import type { Mesh } from './mesh.ts';
import { Matrix3, Matrix4 } from '../math/matrix4.ts';
import { Vector3 } from '../math/vector3.ts';
import { Ray } from '../math/volumes.ts';
import type { Box3 } from '../math/box3.ts';
import type { Geometry } from '../geometry/geometry.ts';
import { forEachReadNode, meshTriangles } from '../../collision/meshTriangles.ts';
import { buildTriangleTree, type TriangleTree } from '../../collision/triangleTree.ts';
import { nearestTriangleOnRay } from '../../collision/triangleQuery.ts';
import { triangleNormal } from '../../collision/closest.ts';

/** Where a ray meets an object: the object itself, the world point and the surface's normal
 *  there, how far along the ray, and which triangle (`-1` when the object's box was hit). */
export interface Intersection {
  /** The object hit: the very node the page added. */
  object: Object3D;
  /** The world point hit. */
  point: Vector3;
  /** The world normal of the face hit, as its winding orients it. */
  normal: Vector3;
  /** Distance from the ray's origin to `point`, world units. */
  distance: number;
  /** The rank of the triangle hit, or `-1` for a box. */
  face: number;
}

const inverse = new Matrix4(),
  normals = new Matrix3(),
  local = new Ray(),
  far = new Vector3(),
  entry = new Vector3(),
  faceNormal = new Float64Array(3);

/** The triangle tree of each shape a ray was cast at, in the shape's own frame, with each tree
 *  triangle's rank; built again once the shape changed (`Geometry.version`). */
const trees = new WeakMap<Geometry, { version: number; tree: TriangleTree; ranks: Uint32Array }>();
function shapeTree(mesh: Mesh) {
  const geometry = mesh.geometry;
  const held = trees.get(geometry);
  if (held?.version === geometry.version) return held;
  const triangles = meshTriangles(mesh, null);
  if (!triangles) return null;
  const ranks = new Uint32Array(triangles.length / 9);
  const built = { version: geometry.version, tree: buildTriangleTree(triangles, ranks), ranks };
  trees.set(geometry, built);
  return built;
}

/** The nearest triangle of a mesh `local` crosses (`nearestTriangleOnRay`): its parameter, rank
 *  and local normal. */
function nearestTriangle(mesh: Mesh) {
  const shape = shapeTree(mesh);
  if (!shape) return null;
  const hit = nearestTriangleOnRay(shape.tree, local.origin.toArray(), local.direction.toArray());
  if (!hit) return null;
  triangleNormal(faceNormal, shape.tree.triangles, hit.at);
  const normal = new Vector3(faceNormal[0], faceNormal[1], faceNormal[2]);
  return { t: hit.t, face: shape.ranks[hit.at / 9], normal };
}

/** The face of `box` a local point lies on, as its outward axis. */
function boxNormal(box: Box3, at: Vector3) {
  const gaps = [
    [at.x - box.min.x, -1, 0, 0],
    [box.max.x - at.x, 1, 0, 0],
    [at.y - box.min.y, 0, -1, 0],
    [box.max.y - at.y, 0, 1, 0],
    [at.z - box.min.z, 0, 0, -1],
    [box.max.z - at.z, 0, 0, 1],
  ];
  const [, x, y, z] = gaps.reduce((a, b) => (Math.abs(b[0]) < Math.abs(a[0]) ? b : a));
  return new Vector3(x, y, z);
}

/** Where `ray` meets one node's own content, in world terms, or null. A triangle mesh is tested
 *  on its triangle tree; lines, points and sprites have no area and are never hit; a node with a
 *  box and no triangles of its own — a loaded model, whose triangles live in GPU pages — is hit
 *  on that box: where the ray enters it, or at the ray's origin (distance 0, the normal facing
 *  back along the ray) when the ray starts inside it. */
function hitNode(node: Object3D, ray: Ray): Intersection | null {
  const mesh = node as Mesh;
  if (mesh.isMesh && mesh.primitive !== 'triangles') return null;
  const box = node.localBounds();
  if (!box || box.isEmpty()) return null;
  node.updateWorldMatrix(true, false);
  inverse.copy(node.matrixWorld).invert();
  // Not normalised: a parameter along the local ray is the world distance along `ray`.
  local.origin.copy(ray.origin).applyMatrix4(inverse);
  far.copy(ray.origin).add(ray.direction).applyMatrix4(inverse);
  local.direction.copy(far).sub(local.origin);
  if (!local.intersectBox(box, entry)) return null;
  if (!mesh.isMesh && box.containsPoint(local.origin)) {
    const back = ray.direction.clone().negate();
    return { object: node, point: ray.origin.clone(), normal: back, distance: 0, face: -1 };
  }
  let hit: { t: number; face: number; normal: Vector3 } | null;
  if (mesh.isMesh) hit = nearestTriangle(mesh);
  else {
    const t = entry.clone().sub(local.origin).dot(local.direction) / local.direction.lengthSq();
    hit = { t, face: -1, normal: boxNormal(box, entry) };
  }
  if (!hit) return null;
  const normal = hit.normal.applyMatrix3(normals.getNormalMatrix(node.matrixWorld)).normalize();
  return { object: node, point: ray.at(hit.t), normal, distance: hit.t, face: hit.face };
}

/**
 * Every object under `roots` that `ray` meets, nearest first, one hit per object: the nearest of
 * its own. The direction is made a unit vector at the door, so every `distance` is in world units
 * whatever length the page gave it. Hidden subtrees are skipped — a root under a hidden ancestor
 * too — and so are the nodes `skip` names with their subtrees: the marks a page works with, never
 * its content.
 */
export function raycast(
  roots: Object3D | readonly Object3D[],
  ray: Ray,
  skip: (node: Object3D) => boolean = () => false,
): Intersection[] {
  const hits: Intersection[] = [];
  const unit = new Ray(ray.origin, ray.direction.clone().normalize());
  forEachReadNode(roots, { skip, visibleOnly: true }, (node) => {
    const hit = hitNode(node, unit);
    if (hit) hits.push(hit);
  });
  return hits.sort((a, b) => a.distance - b.distance);
}
