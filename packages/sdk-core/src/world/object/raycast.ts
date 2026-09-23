import type { Object3D } from './object3d.ts';
import type { Mesh } from './mesh.ts';
import { Matrix3, Matrix4 } from '../math/matrix4.ts';
import { Vector3 } from '../math/vector3.ts';
import { Ray } from '../math/volumes.ts';
import type { Box3 } from '../math/box3.ts';

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
  entry = new Vector3();

/** Möller–Trumbore: the ray parameter where `o + t·d` crosses the triangle, or `-1`. Exact
 *  arithmetic on the triangle's own numbers; a ray in the triangle's plane crosses nothing. */
function crossTriangle(o: Vector3, d: Vector3, p: ArrayLike<number>, [a, b, c]: number[]) {
  const e1x = p[b] - p[a],
    e1y = p[b + 1] - p[a + 1],
    e1z = p[b + 2] - p[a + 2];
  const e2x = p[c] - p[a],
    e2y = p[c + 1] - p[a + 1],
    e2z = p[c + 2] - p[a + 2];
  const px = d.y * e2z - d.z * e2y,
    py = d.z * e2x - d.x * e2z,
    pz = d.x * e2y - d.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det === 0) return -1;
  const tx = o.x - p[a],
    ty = o.y - p[a + 1],
    tz = o.z - p[a + 2];
  const u = (tx * px + ty * py + tz * pz) / det;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y,
    qy = tz * e1x - tx * e1z,
    qz = tx * e1y - ty * e1x;
  const v = (d.x * qx + d.y * qy + d.z * qz) / det;
  if (v < 0 || u + v > 1) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) / det;
  return t >= 0 ? t : -1;
}

/** The nearest triangle of a mesh `local` crosses: its parameter, rank and local normal. */
function nearestTriangle(mesh: Mesh) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  if (!position) return null;
  const index = geometry.index?.array;
  const p = position.array,
    s = position.itemSize;
  const count = Math.floor((index ? index.length : position.count) / 3);
  /** The offsets of face `f`'s three corners in the position array. */
  const corner = [0, 0, 0];
  const corners = (f: number) => {
    for (let k = 0; k < 3; k++) corner[k] = (index ? index[f * 3 + k] : f * 3 + k) * s;
    return corner;
  };
  let best = -1,
    face = -1;
  for (let f = 0; f < count; f++) {
    const t = crossTriangle(local.origin, local.direction, p, corners(f));
    if (t >= 0 && (best < 0 || t < best)) [best, face] = [t, f];
  }
  if (face < 0) return null;
  corners(face);
  const [a, b, c] = corner;
  const e1 = new Vector3(p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]);
  const e2 = new Vector3(p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]);
  return { t: best, face, normal: e1.cross(e2) };
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
 *  triangle by triangle; lines, points and sprites have no area and are never hit; a node with a
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
  const shown = (node: Object3D) => {
    for (let at = node.parent; at; at = at.parent) if (!at.visible || skip(at)) return false;
    return true;
  };
  const walk = (node: Object3D) => {
    if (!node.visible || skip(node)) return;
    const hit = hitNode(node, unit);
    if (hit) hits.push(hit);
    for (const child of node.children) walk(child);
  };
  for (const root of Array.isArray(roots) ? roots : [roots as Object3D])
    if (shown(root)) walk(root);
  return hits.sort((a, b) => a.distance - b.distance);
}
