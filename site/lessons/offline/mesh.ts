import { geometry, type Geometry } from '../../../packages/sdk-browser/index.ts';

/** An authored triangle mesh, before asset compilation: flat position/index arrays, plus the
 *  optional per-vertex attributes a recipe may attach. */
export interface Mesh {
  positions: number[];
  indices: number[];
  colors?: number[];
  normals?: number[];
  uv?: number[];
}

/** Original triangle authoring helpers. These run before asset compilation. */
export function mesh(): Mesh {
  return { positions: [], indices: [] };
}
export function triangle(out: Mesh, a: number[], b: number[], c: number[]) {
  const start = out.positions.length / 3;
  out.positions.push(...a, ...b, ...c);
  out.indices.push(start, start + 1, start + 2);
}
export function surface(nu: number, nv: number, point: (u: number, v: number) => number[]) {
  const out = mesh();
  for (let u = 0; u <= nu; u++)
    for (let v = 0; v <= nv; v++) out.positions.push(...point(u / nu, v / nv));
  for (let u = 0; u < nu; u++)
    for (let v = 0; v < nv; v++) {
      const a = u * (nv + 1) + v,
        b = a + nv + 1;
      out.indices.push(a, b, b + 1, a, b + 1, a + 1);
    }
  return out;
}
export function combine(parts: Mesh[]) {
  const out = mesh();
  for (const part of parts) {
    const offset = out.positions.length / 3;
    out.positions.push(...part.positions);
    out.indices.push(...part.indices.map((i) => i + offset));
  }
  return out;
}
/** Flattens an engine-built `Geometry` into the authored `Mesh` shape, so an offline recipe reads
 *  the engine's own triangulation instead of authoring corners and faces again. */
export function fromSolid(solid: Geometry, place: (p: number[]) => number[] = (p) => p): Mesh {
  const out = mesh();
  const position = solid.attributes.position.array,
    index = solid.index;
  const at = (i: number) => place([position[i * 3], position[i * 3 + 1], position[i * 3 + 2]]);
  const vertexAt = (k: number) => (index ? index.array[k] : k);
  const triangles = (index ? index.count : position.length / 3) / 3;
  for (let t = 0; t < triangles; t++)
    triangle(out, at(vertexAt(t * 3)), at(vertexAt(t * 3 + 1)), at(vertexAt(t * 3 + 2)));
  return out;
}
export function box(center: number[] = [0, 0, 0], size: number[] = [1, 1, 1]) {
  return fromSolid(geometry.box(size[0], size[1], size[2]), (p) => [
    p[0] + center[0],
    p[1] + center[1],
    p[2] + center[2],
  ]);
}
export function mapPositions(source: Mesh, transform: (point: number[]) => number[]): Mesh {
  return {
    ...source,
    positions: source.positions.flatMap((_, i, p) => (i % 3 ? [] : transform(p.slice(i, i + 3)))),
  };
}
