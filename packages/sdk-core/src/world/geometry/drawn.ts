import { crossVector3, normalizeVector3 } from '../../math/primitives/vector.ts';
import { computeNormals } from './normals.ts';
import { GeometryBuilder, fromArrays } from './builder.ts';
import type { Geometry } from './geometry.ts';
import { edgesOf } from './lines.ts';
import { Box3 } from '../math/box3.ts';
import { Vector3 } from '../math/vector3.ts';
import type { Primitive } from '../object/mesh.ts';

const box = new Box3(),
  size = new Vector3();

/** The triangles a mesh draws, as the page cutter reads them. */
export interface DrawnTriangles {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  colors: Float32Array | null;
  indices: Uint32Array;
}

type V3 = [number, number, number];

/**
 * What a mesh draws, as triangles: the engine rasterises triangles alone, so a point is a small
 * octahedron of the material's `size` and a line segment a thin square prism. A line has no
 * width of its own in world units; its prism is `linewidth` × 1/1024 of the geometry's own
 * diagonal thick — one pixel when the geometry spans a 1024-pixel view. That value is NOT
 * derived from the frame (the thickness would have to follow the camera); it is declared here as
 * what it stands for, and a line seen much closer or much further reads thicker or thinner.
 */
export function drawnTriangles(
  geometry: Geometry,
  reading: Primitive,
  options: { size?: number; linewidth?: number; wireframe?: boolean; flat?: boolean } = {},
): DrawnTriangles | null {
  const position = geometry.attributes.position;
  if (!position || position.count === 0) return null;
  const p = Array.from(position.array);
  const corners = geometry.index
    ? Array.from(geometry.index.array)
    : Array.from({ length: position.count }, (_, i) => i);
  if (reading === 'points') return solids(points(p, (options.size ?? 1) / 2));
  const diagonal = box.setFromArray(position.array, position.itemSize).getSize(size).length() || 1;
  const thickness = (diagonal / 1024) * (options.linewidth ?? 1);
  if (reading === 'lineStrip' || reading === 'lineLoop' || reading === 'lineSegments')
    return solids(prisms(p, lineCorners(corners, reading), thickness));
  if (corners.length < 3) return null;
  if (options.wireframe) {
    // Every edge once, however many triangles share it (`edgesOf`).
    const segments = [...edgesOf(geometry).values()].flatMap(({ a, b }) => [a, b]);
    return solids(prisms(p, segments, thickness));
  }
  const attribute = (name: string, width: number) => {
    const a = geometry.attributes[name];
    if (!a || a.count < position.count) return null;
    const out = new Float32Array(position.count * width);
    for (let v = 0; v < position.count; v++)
      for (let c = 0; c < width; c++)
        out[v * width + c] = c < a.itemSize ? a.getComponent(v, c) : 1;
    return out;
  };
  const drawn = {
    positions: new Float32Array(p.length === position.count * 3 ? p : attribute('position', 3)!),
    normals: attribute('normal', 3),
    uvs: attribute('uv', 2),
    colors: attribute('color', 4),
    indices: new Uint32Array(corners.slice(0, corners.length - (corners.length % 3))),
  };
  if (options.flat) return flatten(drawn);
  return { ...drawn, normals: drawn.normals ?? computeNormals(drawn.positions, drawn.indices) };
}

/** The segments a line reading draws, as `[a, b]` corner pairs: each pair of `lineSegments`,
 *  each step of `lineStrip`, and `lineLoop` closed from its last corner back to its first. */
export function lineCorners(
  corners: readonly number[],
  reading: 'lineSegments' | 'lineStrip' | 'lineLoop',
) {
  const segments: number[] = [];
  const step = reading === 'lineSegments' ? 2 : 1;
  for (let i = 0; i + 1 < corners.length; i += step) segments.push(corners[i], corners[i + 1]);
  if (reading === 'lineLoop' && corners.length > 2)
    segments.push(corners[corners.length - 1], corners[0]);
  return segments;
}

/** An octahedron of radius `r` on every vertex. */
function points(p: number[], r: number) {
  const b = new GeometryBuilder();
  // prettier-ignore
  const axes: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]];
  // prettier-ignore
  for (let v = 0; v + 2 < p.length; v += 3)
    for (const [i, j, k] of [[0, 1, 2], [1, 3, 2], [3, 4, 2], [4, 0, 2], [1, 0, 5], [3, 1, 5], [4, 3, 5], [0, 4, 5]])
      face(b, [axes[i], axes[j], axes[k]].map((a) => [p[v] + a[0] * r, p[v + 1] + a[1] * r, p[v + 2] + a[2] * r] as V3));
  return b;
}

/** A square prism of side `t` along each segment `(a, b)`, capped at both ends. */
function prisms(p: number[], segments: number[], t: number) {
  const b = new GeometryBuilder();
  for (let s = 0; s + 1 < segments.length; s += 2) {
    const a: V3 = [p[segments[s] * 3], p[segments[s] * 3 + 1], p[segments[s] * 3 + 2]];
    const e: V3 = [p[segments[s + 1] * 3], p[segments[s + 1] * 3 + 1], p[segments[s + 1] * 3 + 2]];
    const d = e.map((x, i) => x - a[i]) as V3;
    const len = Math.hypot(...d);
    if (len === 0) continue;
    const side = Math.abs(d[0]) < 0.9 * len ? [1, 0, 0] : [0, 1, 0];
    const u = normalOf(d, side as V3),
      w = normalOf(d, u);
    const ring = (o: V3) =>
      [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ].map(([x, y]) => o.map((c, i) => c + ((u[i] * x + w[i] * y) * t) / 2) as V3);
    const [r0, r1] = [ring(a), ring(e)];
    for (let k = 0; k < 4; k++) {
      const n = (k + 1) % 4;
      face(b, [r0[k], r0[n], r1[n]]);
      face(b, [r0[k], r1[n], r1[k]]);
    }
    face(b, [r0[0], r0[2], r0[1]]);
    face(b, [r0[0], r0[3], r0[2]]);
    face(b, [r1[0], r1[1], r1[2]]);
    face(b, [r1[0], r1[2], r1[3]]);
  }
  return b;
}

/** One triangle with its own vertices, wound outward from the solid it closes. */
function face(b: GeometryBuilder, [a, c, d]: V3[]) {
  const n = normalOf(c.map((x, i) => x - a[i]) as V3, d.map((x, i) => x - a[i]) as V3);
  const first = b.vertex(a, n, [0, 0]);
  b.vertex(c, n, [1, 0]);
  b.vertex(d, n, [0, 1]);
  b.triangle(first, first + 1, first + 2);
}

/** The unit vector along `a × b`. */
const normalOf = (a: V3, b: V3): V3 => {
  const out = crossVector3([0, 0, 0] as V3, a, b);
  normalizeVector3(out);
  return out;
};

/** A builder's triangles as drawn arrays. */
function solids(b: GeometryBuilder): DrawnTriangles | null {
  if (!b.indices.length) return null;
  return {
    positions: new Float32Array(b.positions),
    normals: new Float32Array(b.normals),
    uvs: null,
    colors: null,
    indices: new Uint32Array(b.indices),
  };
}

/** Every triangle its own corners, each carrying the face's normal: flat shading. */
function flatten(d: Omit<DrawnTriangles, 'normals'>): DrawnTriangles {
  const pick = (from: Float32Array | null, width: number) => {
    if (!from) return null;
    const out = new Float32Array(d.indices.length * width);
    d.indices.forEach((v, k) => out.set(from.subarray(v * width, v * width + width), k * width));
    return out;
  };
  const positions = pick(d.positions, 3)!;
  const indices = new Uint32Array(d.indices.length).map((_, k) => k);
  return {
    positions,
    normals: computeNormals(positions, null),
    uvs: pick(d.uvs, 2),
    colors: pick(d.colors, 4),
    indices,
  };
}

/** A builder's triangles as a geometry of flat faces: every corner its own, with its face's normal. */
export function flatGeometry(b: GeometryBuilder) {
  const flat = flatten({
    positions: new Float32Array(b.positions),
    uvs: new Float32Array(b.uvs),
    colors: null,
    indices: new Uint32Array(b.indices),
  });
  const list = (a: ArrayLike<number>) => Array.from(a);
  return fromArrays(list(flat.positions), list(flat.normals), list(flat.uvs!), list(flat.indices));
}
