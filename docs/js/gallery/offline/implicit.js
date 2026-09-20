import { mesh, triangle } from './mesh.js';
/** Sample an implicit solid and emit only exposed voxel faces. */
export function implicitShell(resolution = 18) {
  const out = mesh(),
    step = 3 / resolution;
  const inside = (x, y, z) => {
    const p = [x, y, z].map((n) => (n + 0.5) * step - 1.5);
    return Math.hypot(p[0] + 0.45, p[1], p[2]) < 0.85 || Math.hypot(p[0] - 0.45, p[1], p[2]) < 0.85;
  };
  for (let x = 0; x < resolution; x++)
    for (let y = 0; y < resolution; y++)
      for (let z = 0; z < resolution; z++) {
        if (!inside(x, y, z)) continue;
        const cell = [x, y, z];
        for (let axis = 0; axis < 3; axis++)
          for (const sign of [-1, 1]) {
            const next = [...cell];
            next[axis] += sign;
            if (inside(...next)) continue;
            const b = (axis + 1) % 3,
              c = (axis + 2) % 3;
            const points = [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ].map(([u, v]) => {
              const p = cell.map((n) => n * step - 1.5);
              p[axis] += ((sign + 1) / 2) * step;
              p[b] += u * step;
              p[c] += v * step;
              return p;
            });
            if (sign < 0) points.reverse();
            triangle(out, ...points.slice(0, 3));
            triangle(out, points[0], points[2], points[3]);
          }
      }
  return out;
}
/** Intersect a vertical ray with authored triangles; return the highest hit. */
export function verticalHit(geometry, x, z) {
  let height = -Infinity;
  for (let i = 0; i < geometry.indices.length; i += 3) {
    const [a, b, c] = geometry.indices
      .slice(i, i + 3)
      .map((j) => geometry.positions.slice(j * 3, j * 3 + 3));
    const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
    if (Math.abs(d) < 1e-12) continue;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d,
      w = 1 - u - v;
    if (u >= -1e-10 && v >= -1e-10 && w >= -1e-10)
      height = Math.max(height, u * a[1] + v * b[1] + w * c[1]);
  }
  return height === -Infinity ? null : height;
}
