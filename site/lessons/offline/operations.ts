import { mesh, triangle, box, combine, fromSolid, type Mesh } from './mesh.ts';
import { geometry, math } from '../../../packages/sdk-browser/index.ts';
/** A contour in the XY plane, extruded by the engine's own extrude and ear-cut triangulator —
 *  no longer a fan from one vertex, so a concave contour no longer needs to stay convex. */
export function extrude(points: number[][], depth = 1) {
  return fromSolid(geometry.extrude(math.shape(points as [number, number][]), { depth }));
}
export function polygon(sides = 6) {
  return Array.from({ length: sides }, (_, i) => [
    Math.cos((i * 2 * Math.PI) / sides),
    Math.sin((i * 2 * Math.PI) / sides),
  ]);
}
/** Linear midpoint refinement preserves the original piecewise planar surface — unlike
 *  `geometry.polyhedron`'s detail subdivision, which pushes new vertices onto a sphere; this one
 *  keeps an arbitrary caller-supplied mesh flat, so it has no family member to call instead. */
export function subdivide(source: Mesh) {
  const out = mesh(),
    vertex = (i: number) => source.positions.slice(i * 3, i * 3 + 3);
  const middle = (a: number[], b: number[]) => a.map((x, i) => (x + b[i]) / 2);
  for (let i = 0; i < source.indices.length; i += 3) {
    const [a, b, c] = source.indices.slice(i, i + 3).map(vertex),
      ab = middle(a, b),
      bc = middle(b, c),
      ca = middle(c, a);
    triangle(out, a, ab, ca);
    triangle(out, ab, b, bc);
    triangle(out, ca, bc, c);
    triangle(out, ab, bc, ca);
  }
  return out;
}
/** Constructive solid difference on an explicit, bounded voxel grid. */
export function voxelDifference(resolution = 10) {
  const parts = [],
    step = 3 / resolution;
  for (let x = 0; x < resolution; x++)
    for (let y = 0; y < resolution; y++)
      for (let z = 0; z < resolution; z++) {
        const p = [x, y, z].map((v) => (v + 0.5) * step - 1.5);
        if (Math.hypot(p[0], p[2]) > 0.7) parts.push(box(p, [step, step, step]));
      }
  return combine(parts);
}
