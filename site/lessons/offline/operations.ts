import { mesh, triangle, box, combine } from './mesh.ts';
/** Extrude a convex, counterclockwise contour in the XY plane. */
export function extrude(points, depth = 1) {
  const out = mesh(),
    n = points.length;
  const at = (i, z) => [...points[i], z];
  for (let i = 1; i < n - 1; i++) {
    triangle(out, at(0, depth), at(i, depth), at(i + 1, depth));
    triangle(out, at(0, 0), at(i + 1, 0), at(i, 0));
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    triangle(out, at(i, 0), at(j, 0), at(j, depth));
    triangle(out, at(i, 0), at(j, depth), at(i, depth));
  }
  return out;
}
export function polygon(sides = 6) {
  return Array.from({ length: sides }, (_, i) => [
    Math.cos((i * 2 * Math.PI) / sides),
    Math.sin((i * 2 * Math.PI) / sides),
  ]);
}
/** Linear midpoint refinement preserves the original piecewise planar surface. */
export function subdivide(source) {
  const out = mesh(),
    vertex = (i) => source.positions.slice(i * 3, i * 3 + 3);
  const middle = (a, b) => a.map((x, i) => (x + b[i]) / 2);
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
