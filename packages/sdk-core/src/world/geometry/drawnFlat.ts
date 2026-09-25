import { computeNormals } from './normals.ts';
import { fromArrays, type GeometryBuilder } from './builder.ts';
import type { DrawnTriangles } from './drawn.ts';

/** Every triangle its own corners, each carrying the face's normal: flat shading. */
export function flatten(d: Omit<DrawnTriangles, 'normals'>): DrawnTriangles {
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
