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
export function box(center: number[] = [0, 0, 0], size: number[] = [1, 1, 1]) {
  const out = mesh();
  const p = Array.from({ length: 8 }, (_, i) =>
    center.map((c, k) => c + (((i >> k) & 1) - 0.5) * size[k]),
  );
  for (const [a, b, c, d] of [
    [0, 4, 6, 2],
    [1, 3, 7, 5],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 2, 3, 1],
    [4, 5, 7, 6],
  ]) {
    triangle(out, p[a], p[b], p[c]);
    triangle(out, p[a], p[c], p[d]);
  }
  return out;
}
export function mapPositions(source: Mesh, transform: (point: number[]) => number[]): Mesh {
  return {
    ...source,
    positions: source.positions.flatMap((_, i, p) => (i % 3 ? [] : transform(p.slice(i, i + 3)))),
  };
}
