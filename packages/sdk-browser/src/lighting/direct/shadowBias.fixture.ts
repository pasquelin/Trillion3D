// The shadow read of `shadowWgsl.ts` and `shadowFactorWgsl.ts`, restated for the tests of #456:
// the receiver's bias, and the PCF's bilinear comparisons, over a depth map a test describes as
// a function. `shadowBias.test.ts` pins the WGSL lines these restate.
import { LIGHT_SETTINGS, type SceneLight } from '../../../../sdk-core/src/index.ts';
import { writeFace } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { faceBasis } from '../../../../sdk-core/src/scene/light-shadow/math.ts';
import { LAMP_SIDE, SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { PCF_REACH, POISSON_16 } from './shadowWgsl.ts';

type Vec = readonly number[];
/** The depth map: the distance along the light stored at a texel centre. */
export type Stored = (x: number, y: number) => number;
const dot = (a: Vec, b: Vec) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const along = (p: Vec, n: Vec, s: number) => p.map((value, i) => value + n[i] * s);
const length = (v: Vec) => Math.sqrt(dot(v, v));

/** `shadowReceiverBias`: the normal offset, then the depth margin toward the light, in metres. */
export const receiverBias = (texel: number, slope: number) => [
  texel * LIGHT_SETTINGS.shadowNormalOffsetTexels,
  texel * PCF_REACH * slope,
];

/** A hardware comparison at texel coordinate `(x, y)`: each of the four texel centres of the
 *  bilinear footprint is lit when `reference`, a distance along the light, is strictly nearer
 *  than its stored one — the `greater` comparison of reversed depth —, weighted bilinearly. */
export function compare(x: number, y: number, stored: Stored, reference: number) {
  const ax = x - 0.5,
    ay = y - 0.5,
    x0 = Math.floor(ax),
    y0 = Math.floor(ay);
  const wx = [1 - (ax - x0), ax - x0],
    wy = [1 - (ay - y0), ay - y0];
  let lit = 0;
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++)
      if (reference < stored(x0 + i + 0.5, y0 + j + 0.5)) lit += wx[i] * wy[j];
  return lit;
}

/** Sixteen taps' comparisons summed to a lit fraction, rounded off the sum's last bits. */
export const litOf = (sum: number) => Math.round((sum / POISSON_16.length) * 1e9) / 1e9;

/** `shadowPcf` away from a page's edge, a lamp face's `side` clamping its taps at its edge. */
export function pcf(t: Vec, stored: Stored, reference: number, side = 0) {
  const clamp = (v: number) => (side > 0 ? Math.min(Math.max(v, 0.5), side - 0.5) : v);
  let lit = 0;
  for (const [dx, dy] of POISSON_16)
    lit += compare(clamp(t[0] + dx), clamp(t[1] + dy), stored, reference);
  return litOf(lit);
}

/** A face of a profile extruded along z: a segment of the x-y plane, and its outward normal. */
export type Face = { from: Vec; to: Vec; normal: Vec };

/**
 * A sun `zenith` radians from vertical, shining toward +x over a profile of `faces`, read at a
 * texel of `texel` metres, as `sunShadowFactor` reads its level. Returns the lit fraction at the
 * point `x` along face `index` (0 at `from`, 1 at `to`).
 */
export function sunOverProfile(faces: Face[], zenith: number, texel: number) {
  const light = [Math.sin(zenith), -Math.cos(zenith)],
    across = [Math.cos(zenith), Math.sin(zenith)];
  /** The distance along the light of the first face met at `u` across it. */
  const stored = (u: number) => {
    let first = Infinity;
    for (const { from, to } of faces) {
      const e = [to[0] - from[0], to[1] - from[1]],
        o = [u * across[0] - from[0], u * across[1] - from[1]];
      const det = e[0] * -light[1] + light[0] * e[1];
      if (Math.abs(det) < 1e-12) continue;
      const s = (e[0] * o[1] - e[1] * o[0]) / det,
        k = (o[0] * -light[1] + light[0] * o[1]) / det;
      if (k >= 0 && k <= 1) first = Math.min(first, s);
    }
    return first;
  };
  return (index: number, x: number) => {
    const { from, to, normal } = faces[index];
    const P = [from[0] + (to[0] - from[0]) * x, from[1] + (to[1] - from[1]) * x];
    const cosine = Math.min(Math.max(-dot(normal, light), 1e-3), 1);
    const [offset, margin] = receiverBias(texel, Math.sqrt(1 - cosine * cosine) / cosine);
    const Q = along(P, normal, offset);
    return pcf([dot(Q, across) / texel, 0.5], (cx) => stored(cx * texel), dot(Q, light) - margin);
  };
}

/** `pointFaceOf`: the major axis of the light-to-point direction, in `POINT_FACE_AXES` order. */
export function pointFaceOf(d: Vec) {
  const [x, y, z] = d.map(Math.abs);
  if (x >= y && x >= z) return d[0] > 0 ? 0 : 1;
  if (y >= z) return d[1] > 0 ? 2 : 3;
  return d[2] > 0 ? 4 : 5;
}

/** A receiver plane: a point of it and its normal. */
export type Plane = { at: Vec; normal: Vec };

/**
 * A point light at `at` over `planes`, its six faces composed by `writeFace` as the record holds
 * them. Returns `lampShadowFactor` at `mip` for the point `P` of normal `N`: the face it read, the
 * offset point's place in it, and the lit fraction — the map holding, at each texel, the depth
 * along the face's axis of the first plane its ray meets.
 */
export function pointLampOver(at: Vec, planes: Plane[]) {
  const light = { id: 'lamp', kind: 'point', position: at, range: 20 } as unknown as SceneLight;
  const m = new Float32Array(6 * 16),
    frames: number[][] = [];
  let tan = 0;
  for (let face = 0; face < 6; face++) {
    tan = Math.tan(writeFace(m, face * 16, null, 0, light, face).halfFov);
    frames.push(Array.from(faceBasis));
  }
  const clip = (face: number, p: Vec, w: number) =>
    [0, 1, 2, 3].map((r) =>
      dot(
        [0, 4, 8, 12].map((c) => m[face * 16 + c + r]),
        [...p, w],
      ),
    );
  const stored = (face: number, a: number, b: number) => {
    const f = frames[face],
      ray = [0, 1, 2].map((i) => f[6 + i] + a * tan * f[i] + b * tan * f[3 + i]);
    let first = Infinity;
    for (const { at: on, normal } of planes) {
      const s =
        dot(
          normal,
          on.map((v, i) => v - at[i]),
        ) / dot(normal, ray);
      if (s > 0) first = Math.min(first, s);
    }
    return first;
  };
  return (P: Vec, N: Vec, mip: number) => {
    const radius = length(P.map((v, i) => v - at[i]));
    const cosine = Math.min(
      Math.max(
        -dot(
          N,
          P.map((v, i) => v - at[i]),
        ) / radius,
        1e-3,
      ),
      1,
    );
    const texel = ((2 * tan * radius) / (LAMP_SIDE * SHADOW_PAGE)) * 2 ** mip;
    const Q = along(P, N, texel * LIGHT_SETTINGS.shadowNormalOffsetTexels);
    const face = pointFaceOf(Q.map((v, i) => v - at[i]));
    const [x, y, , w] = clip(face, Q, 1),
      side = (LAMP_SIDE >> mip) * SHADOW_PAGE;
    const ndc = [x / w, y / w];
    const reach = w / length(Q.map((v, i) => v - at[i])),
      facing = clip(face, N, 0)[3];
    const slope = (Math.sqrt(Math.max(1 - facing * facing, 0)) * reach * reach) / cosine;
    const t = [(ndc[0] * 0.5 + 0.5) * side, (0.5 - ndc[1] * 0.5) * side];
    const map = (cx: number, cy: number) => stored(face, (2 * cx) / side - 1, 1 - (2 * cy) / side);
    return { face, ndc, lit: pcf(t, map, w - receiverBias(texel, slope)[1], side) };
  };
}
