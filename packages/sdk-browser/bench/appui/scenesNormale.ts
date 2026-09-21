// Hostile frames of the batch-4 bench: poses, vertex attributes and barycentric weights chosen
// to hit every edge case of the tangent frame — a zero vector that normalization leaves
// zero, a singular matrix whose normal matrix is zero, a negative scale that flips the
// face, shear, non-uniform scale, NaN, ±0 and infinities.
//
// Two pairs are there so term order is visible. One pose carries a cancelling row
// (`1e16`, `−1e16`, `3`) that all-ones vertices walk: the sum is 3 in the reference
// order and 4 in the other. A second pose has a normal matrix of exactly
// `[[1, 1, 1], [0, 1, 0], [0, 0, 1]]`, and the vertex normals that go with it are
// `(1e16, 1, 1)`: again the sum depends on order. Without those two, every pose is
// sparse enough that a reassociated add would go unnoticed.
//
// Attributes are in single precision, like imported geometry: both sides therefore
// read the same rounded values, and any delta can only come from the algebra.
import * as THREE from 'three';
import { triangleAt } from '../../visibilityMath.ts';
import type { VisPage } from '../../visibilityTypes.ts';

/** Hostile poses, column-major: shear, singular and cancelling row included. */
const POSES = [
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  [-1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0.25, 0, 5, -2, 7, 1],
  [0.5, 0.25, 0, 0, -0.75, 2, 0.5, 0, 0.125, -0.25, 1.5, 0, 1, 2, 3, 1],
  [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1],
  [1, 2, 3, 0, 2, 4, 6, 0, 3, 6, 9, 0, 0, 0, 0, 1],
  [1e-30, 0, 0, 0, 0, 1e-30, 0, 0, 0, 0, 1e-30, 0, 0, 0, 0, 1],
  [NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  [Infinity, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1],
  [1e16, 1, 1, 0, -1e16, 1, 1, 0, 3, 1, 1, 0, 0, 0, 0, 1],
  [1, -1, -1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
];

/** Vertex-normal triplets: unit, zero, signed, non-finite, all-ones, very spread. */
const NORMALES = [
  [0, 1, 0, 0, 1, 0, 0, 1, 0],
  [0, 0, 0, 1, 0, 0, 0, 0, 1],
  [-0, -0, -0, 0.6, 0, 0.8, -1, -0, 0],
  [NaN, 1, 0, Infinity, 0, 0, 1, -Infinity, 0],
  [1e-38, 1e-38, 1e-38, 0.5, 0.5, 0.5, -0.5, 0.5, -0.5],
  [1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1e16, 1, 1, 1e16, 1, 1, 1e16, 1, 1],
];

/** Tangent triplets `(x, y, z, w)`: `w` carries the bitangent sign. */
const TANGENTES = [
  [1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1],
  [0, 0, 0, -1, 1, 0, 0, -1, 0, 1, 0, 1],
  [-0, 0, -0, 0, NaN, 0, 0, 1, Infinity, 0, 0, -1],
  [1, 1, 1, 1, 1, 1, 1, -1, 1, 1, 1, 1],
];

/** Texture coordinates: flat (degenerate), ordinary, and non-finite. */
const UVS = [
  [0, 0, 1, 0, 0, 1],
  [0.25, 0.25, 0.25, 0.25, 0.25, 0.25],
  [-0, 0, NaN, 1, 2, Infinity],
];

/** World vertices: an ordinary triangle, a flat triangle, a non-finite triangle. */
const TRIANGLES = [
  [0, 0, 0, 1, 0, 0, 0, 1, 0],
  [2, 3, 4, 2, 3, 4, 2, 3, 4],
  [-0, 0, 0, 1e30, 0, 0, 0, NaN, 0],
];

/** Hostile barycentric weights: signed zero, NaN, infinities, denormal. */
const POIDS = [
  [0.25, 0.25, 0.5],
  [1, 0, -0],
  [0, -0, NaN],
  [Infinity, -Infinity, 1],
  [5e-324, 1, -1],
];

/** The retained fittings: `[NORMALES, TANGENTES, UVS]`, the last all-ones. */
const GARNITURES: [number, number, number][] = [
  [0, 0, 0],
  [1, 1, 1],
  [2, 2, 2],
  [3, 2, 1],
  [4, 0, 2],
  [5, 3, 0],
  [6, 3, 0],
];

const attribut = (valeurs: number[], size: number) =>
  new THREE.BufferAttribute(Float32Array.from(valeurs), size);

/** The four attribute sets of a fitting: with tangents, without, without normals, without UV. */
function attributs([n, t, u]: [number, number, number]): THREE.BufferGeometry['attributes'][] {
  const normal = () => attribut(NORMALES[n], 3),
    tangent = () => attribut(TANGENTES[t], 4),
    uv = () => attribut(UVS[u], 2);
  return [
    { normal: normal(), tangent: tangent(), uv: uv() },
    { normal: normal(), uv: uv() },
    { uv: uv() },
    { normal: normal(), tangent: tangent() },
  ];
}

/** A projected vertex as the rasterizer yields it: only the world position is read here, so
 *  the screen fields `x`/`y`/`z`/`invW` `Projected` also carries are filled but never checked. */
const sommet = (v: number[], at: number) => ({
  x: 0,
  y: 0,
  z: 0,
  invW: 1,
  worldX: v[at],
  worldY: v[at + 1],
  worldZ: v[at + 2],
});

/**
 * The full product: each pose, each fitting, each triangle, each weight set. Vertex
 * indices rotate so the three corners do not always read the same row.
 */
export interface Repere {
  page: VisPage;
  tri: NonNullable<ReturnType<typeof triangleAt>>;
  bary: { w0: number; w1: number; w2: number };
}

export function reperes(): Repere[] {
  const lot: Repere[] = [];
  for (const pose of POSES) {
    const matrix = new THREE.Matrix4().fromArray(pose);
    for (const garniture of GARNITURES)
      for (const attributes of attributs(garniture))
        for (let v = 0; v < TRIANGLES.length; v++) {
          const coins = TRIANGLES[v];
          const page = { array: new Uint32Array([0, 1, 2]), attributes, matrix, material: [] };
          const tri = {
            a: sommet(coins, 0),
            b: sommet(coins, 3),
            c: sommet(coins, 6),
            page,
            triangleIndex: 0,
            i0: 0,
            i1: (v + 1) % 3,
            i2: (v + 2) % 3,
          };
          for (const w of POIDS)
            lot.push({
              page,
              tri,
              bary: { w0: w[0], w1: w[1], w2: w[2] },
            });
        }
  }
  return lot;
}
