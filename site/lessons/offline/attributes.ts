import { mesh, triangle, box, combine, type Mesh } from './mesh.ts';
import { terrain } from './surfaces.ts';
import { math } from '../../../packages/sdk-browser/index.ts';
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
/** Separate corners and attach one face normal per triangle — a deliberately flat shading, over
 *  duplicated corners, that `Geometry.computeVertexNormals` does not produce: that one is smooth
 *  and area-weighted over an indexed mesh's shared vertices, the opposite of what this wants. */
export function splitEdges(source: Mesh) {
  const out = mesh();
  out.normals = [];
  for (let i = 0; i < source.indices.length; i += 3) {
    const [a, b, c] = source.indices
      .slice(i, i + 3)
      .map((j) => source.positions.slice(j * 3, j * 3 + 3));
    const normal = math
      .vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      .cross(math.vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]))
      .normalize();
    triangle(out, a, b, c);
    for (let j = 0; j < 3; j++) out.normals.push(normal.x, normal.y, normal.z);
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
