// Shadow oracles of batch M1 "math foundation": projection, view, product and cone of a
// shadow face from before the attachment, copied as-is from `develop` at commit d016f88.
import { LIGHT_SETTINGS } from '../../../packages/sdk-core/src/scene/light/contracts.ts';

/** `packages/sdk-core/src/scene/light-shadow/math.ts:14-46` from before, written into a given buffer rather than in the
 *  module. Only the depth row follows the engine convention — reversed, near plane at 1: it is
 *  the INPUT of the product that the oracle witnesses, not the projection formula. */
export function referenceShadowProjection(proj: Float32Array, fov: number, range: number) {
  const near = Math.max(LIGHT_SETTINGS.shadowNearMin, range * LIGHT_SETTINGS.shadowNearFraction),
    far = Math.max(near * 1.001, range);
  const f = 1 / Math.tan(fov / 2),
    depth = near / (far - near);
  proj.fill(0);
  proj[0] = f;
  proj[5] = f;
  proj[10] = depth;
  proj[11] = -1;
  proj[14] = far * depth;
}
export function referenceShadowOrthographic(proj: Float32Array, halfExtent: number, far: number) {
  proj.fill(0);
  proj[0] = 1 / halfExtent;
  proj[5] = 1 / halfExtent;
  proj[10] = 1 / far;
  proj[14] = 1;
  proj[15] = 1;
}

/** `packages/sdk-core/src/scene/light-shadow/math.ts:48-138` from before: basis, view and product in a loop from zero. */
export const referenceFaceBasis = new Float64Array(9);
function shadowView(
  out: Float32Array,
  base: number,
  eye: readonly number[],
  forward: readonly number[],
) {
  const fx = forward[0],
    fy = forward[1],
    fz = forward[2];
  const up = Math.abs(fy) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  let rx = fy * up[2] - fz * up[1],
    ry = fz * up[0] - fx * up[2],
    rz = fx * up[1] - fy * up[0];
  const rl = Math.hypot(rx, ry, rz) || 1;
  rx /= rl;
  ry /= rl;
  rz /= rl;
  const ux = ry * fz - rz * fy,
    uy = rz * fx - rx * fz,
    uz = rx * fy - ry * fx;
  const b = referenceFaceBasis;
  b[0] = rx;
  b[1] = ry;
  b[2] = rz;
  b[3] = ux;
  b[4] = uy;
  b[5] = uz;
  b[6] = fx;
  b[7] = fy;
  b[8] = fz;
  out[base] = rx;
  out[base + 1] = ux;
  out[base + 2] = -fx;
  out[base + 3] = 0;
  out[base + 4] = ry;
  out[base + 5] = uy;
  out[base + 6] = -fy;
  out[base + 7] = 0;
  out[base + 8] = rz;
  out[base + 9] = uz;
  out[base + 10] = -fz;
  out[base + 11] = 0;
  out[base + 12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  out[base + 13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[base + 14] = fx * eye[0] + fy * eye[1] + fz * eye[2];
  out[base + 15] = 1;
}
function multiply4(
  out: Float32Array,
  outBase: number,
  a: Float32Array,
  aBase: number,
  b: Float32Array,
  bBase: number,
  scratch: Float32Array,
) {
  for (let column = 0; column < 4; column++)
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[aBase + k * 4 + row] * b[bBase + column * 4 + k];
      scratch[column * 4 + row] = sum;
    }
  for (let i = 0; i < 16; i++) out[outBase + i] = scratch[i];
}
const viewScratch = new Float32Array(16),
  mulScratch = new Float32Array(16);
export function referenceComposeFace(
  out: Float32Array,
  base: number,
  eye: readonly number[],
  forward: readonly number[],
  proj: Float32Array,
) {
  shadowView(viewScratch, 0, eye, forward);
  multiply4(out, base, proj, 0, viewScratch, 0, mulScratch);
}

/** `packages/sdk-core/src/scene/light-shadow/volume.ts:13-66` from before, on the basis of the face composed by the oracle. */
const axis = new Float64Array(3),
  corner = new Float64Array(3);
function direction(out: Float64Array, u: number, v: number, t: number) {
  const faceBasis = referenceFaceBasis;
  let length = 0;
  for (let a = 0; a < 3; a++) {
    out[a] = faceBasis[6 + a] + t * (u * faceBasis[a] + v * faceBasis[3 + a]);
    length += out[a] * out[a];
  }
  length = Math.sqrt(length) || 1;
  for (let a = 0; a < 3; a++) out[a] /= length;
}
export function referenceConeAxisCosine(rect: Float64Array, halfFov: number) {
  const t = Math.tan(halfFov);
  direction(axis, (rect[0] + rect[1]) / 2, (rect[2] + rect[3]) / 2, t);
  let cosine = 1;
  for (let index = 0; index < 4; index++) {
    direction(corner, index & 1 ? rect[1] : rect[0], index & 2 ? rect[3] : rect[2], t);
    const dot = axis[0] * corner[0] + axis[1] * corner[1] + axis[2] * corner[2];
    if (dot < cosine) cosine = dot;
  }
  return [axis[0], axis[1], axis[2], Math.acos(Math.max(-1, Math.min(1, cosine)))];
}
