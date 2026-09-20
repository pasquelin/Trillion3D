import { mesh, triangle, box, combine } from './mesh.js';
import { terrain } from './surfaces.js';
export function paintedTerrain(lookup = false) {
  const out = terrain(24, 0.8);
  out.colors = out.positions.flatMap((v, i) => {
    if (i % 3 !== 1) return [];
    const t = Math.max(0, Math.min(1, (v + 0.4) / 0.8));
    return lookup
      ? [t, 1 - Math.abs(2 * t - 1), 1 - t, 1]
      : [0.15 + 0.6 * t, 0.6, 0.8 - 0.5 * t, 1];
  });
  return out;
}
/** Separate corners and attach one face normal per triangle. */
export function splitEdges(source) {
  const out = mesh();
  out.normals = [];
  for (let i = 0; i < source.indices.length; i += 3) {
    const [a, b, c] = source.indices
      .slice(i, i + 3)
      .map((j) => source.positions.slice(j * 3, j * 3 + 3));
    const u = b.map((x, k) => x - a[k]),
      v = c.map((x, k) => x - a[k]);
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n) || 1;
    triangle(out, a, b, c);
    for (let j = 0; j < 3; j++) out.normals.push(...n.map((x) => x / length));
  }
  return out;
}
/** Original block-letter contour; no font or glyph asset is imported. */
export function lettering(depth = 0.25) {
  const rows = ['100010111', '100010100', '101010111', '101010001', '010100111'];
  return combine(
    rows.flatMap((row, y) =>
      Array.from(row).flatMap((cell, x) =>
        cell === '1' ? [box([(x - 4) * 0.35, (2 - y) * 0.35, 0], [0.3, 0.3, depth])] : [],
      ),
    ),
  );
}
export function uvTiles() {
  const out = splitEdges(terrain(8, 0.2));
  out.uv = out.positions.flatMap((_, i) =>
    i % 3 ? [] : [((i * 17) % 101) / 100, ((i * 29) % 97) / 96],
  );
  return out;
}
