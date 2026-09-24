import { crossVector3, normalizeVector3 } from '../../math/primitives/vector.ts';
import { BufferAttribute } from '../buffer/index.ts';
import { Geometry } from './geometry.ts';
import { computeNormals } from './normals.ts';

type V3 = readonly [number, number, number];
/** One vertex of a parametric surface: where it is, which way it faces, its texture point. */
export type SurfacePoint = { p: V3; n: V3; uv: readonly [number, number] };

/** Accumulates vertices and triangles, then hands over one geometry. */
export class GeometryBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];

  get vertexCount() {
    return this.positions.length / 3;
  }
  vertex(p: V3, n: V3, uv: readonly [number, number]) {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.uvs.push(uv[0], uv[1]);
    return this.vertexCount - 1;
  }
  triangle(a: number, b: number, c: number) {
    this.indices.push(a, b, c);
  }
  /**
   * A `(uSeg + 1) × (vSeg + 1)` sheet of `at(u, v)`, two triangles per cell. Its winding is read
   * off the surface itself: a cell whose geometric normal disagrees with the declared normals
   * is wound the other way, so every front face faces where the generator says it faces.
   */
  grid(uSeg: number, vSeg: number, at: (u: number, v: number) => SurfacePoint) {
    const base = this.vertexCount;
    for (let j = 0; j <= vSeg; j++)
      for (let i = 0; i <= uSeg; i++) {
        const s = at(i / uSeg, j / vSeg);
        this.vertex(s.p, s.n, s.uv);
      }
    const id = (i: number, j: number) => base + j * (uSeg + 1) + i;
    for (let j = 0; j < vSeg; j++)
      for (let i = 0; i < uSeg; i++) {
        const [a, b, c, d] = [id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)];
        if (this.facesDeclared(a, b, c, d)) {
          this.triangle(a, b, c);
          this.triangle(a, c, d);
        } else {
          this.triangle(a, c, b);
          this.triangle(a, d, c);
        }
      }
  }
  /** True when the cell `a b c d`, wound so, faces the way its declared normals do. */
  private facesDeclared(a: number, b: number, c: number, d: number) {
    const P = this.positions,
      N = this.normals;
    const e1 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => P[d * 3 + k] - P[b * 3 + k]);
    const n = crossVector3([0, 0, 0], e1, e2);
    let dot = 0;
    for (const v of [a, b, c, d]) for (let k = 0; k < 3; k++) dot += n[k] * N[v * 3 + k];
    return dot >= 0;
  }
  /** The geometry, indexed; `computeNormals` replaces the declared normals by the faces'. Its
   *  values are held at the precision they were computed at: a corner the parameters place at
   *  exactly 0.35 or 1.2 stays there, and only the drawn copy is narrowed (`drawn.ts`). */
  build(options: { computeNormals?: boolean } = {}) {
    const geometry = new Geometry();
    geometry.setAttribute('position', new BufferAttribute(new Float64Array(this.positions), 3));
    const normals = options.computeNormals
      ? computeNormals(this.positions, this.indices)
      : new Float64Array(this.normals);
    geometry.setAttribute('normal', new BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float64Array(this.uvs), 2));
    geometry.setIndex(this.indices);
    return geometry;
  }
}

/** A geometry of flat arrays a generator wrote: positions, normals, texture points, triangles. */
export function fromArrays(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
) {
  const builder = new GeometryBuilder();
  const into = [builder.positions, builder.normals, builder.uvs, builder.indices];
  [positions, normals, uvs, indices].forEach((from, k) => {
    for (const value of from) into[k].push(value);
  });
  return builder.build();
}

/** A count of pieces as a shape can build it: a whole number, at least `least` — the fewest a
 *  shape of that family closes with. What its recipe records, so the recipe says what was built. */
export const pieces = (count: number, least: number) => Math.max(least, Math.floor(count));

export const normalize = (x: number, y: number, z: number): [number, number, number] => {
  const out: [number, number, number] = [x, y, z];
  normalizeVector3(out);
  return out;
};
