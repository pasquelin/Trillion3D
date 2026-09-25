import { crossVector3, normalizeVector3 } from '../../math/primitives/vector.ts';
import { BufferAttribute } from '../buffer/index.ts';
import type { VertexAttribute } from '../buffer/attribute.ts';
import { Geometry } from './geometry.ts';
import { readComponent } from './bounds.ts';

/** The three numbers of vertex `v` of `position`, as `geometry` reads them. */
const at = (geometry: Geometry, position: VertexAttribute, v: number) => [
  readComponent(geometry, position, v, 0),
  readComponent(geometry, position, v, 1),
  readComponent(geometry, position, v, 2),
];

/** Every triangle edge of `geometry` once, as `[a, b]` corner pairs and the faces it borders. */
export function edgesOf(geometry: Geometry) {
  const position = geometry.attributes.position;
  const count = position?.count ?? 0;
  const corners = geometry.index
    ? Array.from(geometry.index.array)
    : Array.from({ length: count }, (_, i) => i);
  // Corners that share a position share an edge, whatever their other attributes.
  const edges = new Map<string, { a: number; b: number; normals: number[][] }>();
  for (let t = 0; t + 2 < corners.length; t += 3) {
    const tri = [corners[t], corners[t + 1], corners[t + 2]];
    const p = tri.map((v) => at(geometry, position, v));
    const keys = p.map(([x, y, z]) => `${x},${y},${z}`);
    const e1 = p[1].map((x, i) => x - p[0][i]),
      e2 = p[2].map((x, i) => x - p[0][i]);
    const n = crossVector3([0, 0, 0], e1, e2);
    normalizeVector3(n);
    for (let k = 0; k < 3; k++) {
      const [a, b] = [tri[k], tri[(k + 1) % 3]];
      const id = [keys[k], keys[(k + 1) % 3]].sort().join('|');
      const edge = edges.get(id) ?? { a, b, normals: [] };
      edge.normals.push(n);
      edges.set(id, edge);
    }
  }
  return edges;
}

/** Line-segment geometry of the chosen edges: two positions per segment. */
function segments(geometry: Geometry, keep: (normals: number[][]) => boolean) {
  const position = geometry.attributes.position;
  const out: number[] = [];
  for (const { a, b, normals } of edgesOf(geometry).values())
    if (keep(normals)) for (const v of [a, b]) out.push(...at(geometry, position, v));
  const lines = new Geometry();
  lines.setAttribute('position', new BufferAttribute(new Float32Array(out), 3));
  return lines;
}

/**
 * The edges where the surface folds by more than `thresholdAngle` degrees, and its borders.
 * @param geometry - The shape whose edges are drawn.
 * @param thresholdAngle - Least angle between two faces, in degrees, for their shared edge to show.
 */
export function edges(geometry: Geometry, thresholdAngle = 1) {
  const limit = Math.cos((thresholdAngle * Math.PI) / 180);
  return segments(
    geometry,
    (normals) =>
      normals.length < 2 ||
      normals[0][0] * normals[1][0] +
        normals[0][1] * normals[1][1] +
        normals[0][2] * normals[1][2] <=
        limit,
  );
}

/**
 * Every edge of every triangle, once.
 * @param geometry - The shape whose triangle edges are drawn.
 */
export function wireframe(geometry: Geometry) {
  return segments(geometry, () => true);
}
