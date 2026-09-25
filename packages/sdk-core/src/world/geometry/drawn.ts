import { crossVector3, lengthSqVector3, normalizeVector3 } from '../../math/primitives/vector.ts';
import { computeNormals } from './normals.ts';
import { GeometryBuilder, fromArrays } from './builder.ts';
import type { Geometry } from './geometry.ts';
import { edgesOf } from './lines.ts';
import type { Primitive } from '../object/mesh.ts';

/** The triangles a mesh draws, as the page cutter reads them. `lines` says they are line quads
 *  (`quads`), which every raster widens on screen by the surface's `lineWidth`; a dashed line's
 *  quads carry their distance along the line in the first coordinate of `uvs`. */
export interface DrawnTriangles {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  colors: Float32Array | null;
  indices: Uint32Array;
  lines?: boolean;
}

type V3 = [number, number, number];

/**
 * What a mesh draws, as triangles: the engine rasterises triangles alone, so a point is a small
 * octahedron of the material's `size` and a line segment a quad of two triangles whose corners
 * all sit on the segment (`quads`). A line has no width in world units: the rasters widen each
 * quad on screen to the surface's `lineWidth` in CSS pixels, at every distance
 * (`sdk-browser/src/visibility/shader/lineWgsl.ts`). A `dashed` line's quads also carry the
 * distance along the line of each corner, which the rasters cut into dashes and gaps.
 */
export function drawnTriangles(
  geometry: Geometry,
  reading: Primitive,
  options: { size?: number; wireframe?: boolean; flat?: boolean; dashed?: boolean } = {},
): DrawnTriangles | null {
  const position = geometry.attributes.position;
  if (!position || position.count === 0) return null;
  const p = Array.from(position.array);
  const corners = geometry.index
    ? Array.from(geometry.index.array)
    : Array.from({ length: position.count }, (_, i) => i);
  if (reading === 'points') return solids(points(p, (options.size ?? 1) / 2));
  if (reading === 'lineStrip' || reading === 'lineLoop' || reading === 'lineSegments') {
    const segments: number[] = [];
    const step = reading === 'lineSegments' ? 2 : 1;
    for (let i = 0; i + 1 < corners.length; i += step) segments.push(corners[i], corners[i + 1]);
    if (reading === 'lineLoop' && corners.length > 2)
      segments.push(corners[corners.length - 1], corners[0]);
    return quads(p, segments, options.dashed);
  }
  if (corners.length < 3) return null;
  if (options.wireframe) {
    // Every edge once, however many triangles share it (`edgesOf`).
    const segments = [...edgesOf(geometry).values()].flatMap(({ a, b }) => [a, b]);
    return quads(p, segments, options.dashed);
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

/**
 * Two triangles per segment `(a, b)`, every corner on an endpoint: `a` twice, then `b` twice. A
 * corner's normal is the segment's direction, signed by the side of the line it moves to once
 * widened: `+d` to the left of the segment on screen, `-d` to the right. The quad has no area
 * until a raster widens it, and a pass that does not (the shadow depth) draws nothing of it.
 *
 * `dashed`: each corner also carries, as `(u, 0)`, its distance along the line — the running
 * length of the segments before it, in their order, as the reference's `computeLineDistances`
 * measures it, a loop's closing segment continuing the count. Only a dashed line pays it: any
 * other line's quads keep no coordinate.
 */
function quads(p: number[], segments: number[], dashed = false): DrawnTriangles | null {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  let distance = 0;
  for (let s = 0; s + 1 < segments.length; s += 2) {
    const a = segments[s] * 3,
      b = segments[s + 1] * 3;
    const d: V3 = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]];
    const length = Math.sqrt(lengthSqVector3(d));
    if (length === 0) continue;
    normalizeVector3(d);
    const first = positions.length / 3;
    for (const [at, side] of [
      [a, 1],
      [a, -1],
      [b, 1],
      [b, -1],
    ]) {
      positions.push(p[at], p[at + 1], p[at + 2]);
      normals.push(d[0] * side, d[1] * side, d[2] * side);
      if (dashed) uvs.push(at === a ? distance : distance + length, 0);
    }
    distance += length;
    indices.push(first, first + 1, first + 3, first, first + 3, first + 2);
  }
  if (!indices.length) return null;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: dashed ? new Float32Array(uvs) : null,
    colors: null,
    indices: new Uint32Array(indices),
    lines: true,
  };
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
