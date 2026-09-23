/**
 * Oracle D1/D2: `viewProj * world` product computed once and re-read for multiple vertices, against
 * the same product recomputed for each vertex. Both shaders (packages/sdk-browser/src/gpu/raster/shader.ts,
 * packages/sdk-browser/src/visibility/shader/visWgsl.ts) apply exactly this transformation; this module holds the JS algebra
 * (column-major mat4x4f, like WGSL) to verify it on hostile matrices — mirrored,
 * near-singular, large scale — without depending on GPU execution.
 */

export type Mat4 = readonly number[]; // 16 numbers, column-major: m[col*4+row]
type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  return out;
}

function mat4MulVec4(m: Mat4, v: Vec4): Vec4 {
  const out: number[] = [0, 0, 0, 0];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) out[row] += m[col * 4 + row] * v[col];
  return out as unknown as Vec4;
}

/** determinant(mat3x3f(world[0].xyz, world[1].xyz, world[2].xyz)): first three columns. */
export function upperLeftDeterminant(world: Mat4): number {
  const c0: Vec3 = [world[0], world[1], world[2]];
  const c1: Vec3 = [world[4], world[5], world[6]];
  const c2: Vec3 = [world[8], world[9], world[10]];
  const crossX = c1[1] * c2[2] - c1[2] * c2[1];
  const crossY = c1[2] * c2[0] - c1[0] * c2[2];
  const crossZ = c1[0] * c2[1] - c1[1] * c2[0];
  return c0[0] * crossX + c0[1] * crossY + c0[2] * crossZ;
}

/** Product computed once (`vp`), applied to each vertex — kernel of batch D1/D2. */
export function hoisted(viewProj: Mat4, world: Mat4, vertices: readonly Vec4[]): Vec4[] {
  const vp = mat4Multiply(viewProj, world);
  return vertices.map((v) => mat4MulVec4(vp, v));
}

/** Product recomputed for each vertex — legacy kernel replaced by D1/D2. */
export function perVertex(viewProj: Mat4, world: Mat4, vertices: readonly Vec4[]): Vec4[] {
  return vertices.map((v) => mat4MulVec4(mat4Multiply(viewProj, world), v));
}

export const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** Mirror on X: negative determinant, like an imported cluster with negative scale. */
export const MIRROR_X: Mat4 = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, -5, 1];
/** Near-singular: column nearly collinear to another. */
export const NEAR_SINGULAR: Mat4 = [
  1,
  0,
  0,
  0,
  1 + 1e-9,
  1e-9,
  0,
  0,
  0,
  0,
  1e-6,
  0,
  10,
  -10,
  100,
  1,
];
/** Large scale, like a world imported in millimeters then composed with a distant camera. */
export const LARGE_SCALE: Mat4 = [1e5, 0, 0, 0, 0, 1e5, 0, 0, 0, 0, 1e5, 0, -1e6, 2e6, 3e6, 1];
