// The shadow read of `shadowWgsl.ts` and `shadowFactorWgsl.ts`, restated for the tests of #456:
// the receiver's bias, and the PCF's bilinear comparisons, over a depth map a test describes as
// a function. `RESTATED` holds the WGSL lines restated here; the tests pin them.
import { LIGHT_SETTINGS, type SceneLight } from '../../../../sdk-core/src/index.ts';
import { dot } from '../../../../sdk-core/src/math/projectionOracles.ts';
import { transformHomogeneousPoint } from '../../../../sdk-core/src/math/primitives/vector.ts';
import { writeFace } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { faceBasis } from '../../../../sdk-core/src/scene/light-shadow/math.ts';
import { LAMP_SIDE, SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { PCF_REACH, POISSON_16, directShadowWgsl } from './shadowWgsl.ts';

type Vec = readonly number[];
/** The depth map: the distance along the light stored at a texel centre. */
export type Stored = (x: number, y: number) => number;

/** The shading's shadow read, as a pass declares it. */
export const SHADOW_WGSL = directShadowWgsl(8, null, 18);
/** The lines this fixture restates. */
export const RESTATED = [
  'fn shadowDepthMargin(texel:f32,slope:f32)->f32{return texel*SHADOW_PCF_REACH*slope;}',
  ' let cosine=clamp(dot(N,-axis),1e-3,1.0);',
  ' let slope=sqrt(1.0-cosine*cosine)/cosine;',
  '  let Q=P+N*texel*SHADOW_NORMAL_TEXELS;',
  '  let reference=1.0-(dot(Q,axis)-zNear-shadowDepthMargin(texel,slope))*invDepth;',
  ' let texel0=2.0*info.y*radius/(f32(LAMP_PAGE_COUNT)*SHADOW_PAGE);',
  ' let k=near*far/(far-near);',
  '  let d=Q-light.positionRange.xyz;',
  '  let face=select(0u,pointFaceOf(d),u32(info.x)==6u);',
  '  let clip=m*vec4f(Q,1.0);',
  '  let t=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5)*side;',
  '  let facing=dot(N,vec3f(m[0].w,m[1].w,m[2].w));',
  '  let slope=sqrt(max(1.0-facing*facing,0.0))/cosine;',
  '  return shadowPcf(map,t,ndc.z+shadowDepthMargin(texel,slope)*k/dot(d,d),home,word,side);',
  '  if(side>0.0){at=clamp(at,vec2f(0.5),vec2f(side-0.5));}',
];

const along = (p: Vec, n: Vec, s: number) => p.map((value, i) => value + n[i] * s);
const sub = (a: Vec, b: Vec) => a.map((value, i) => value - b[i]);
export const clamp = (v: number, low: number, high: number) => Math.min(Math.max(v, low), high);
/** `shadowDepthMargin`, in metres toward the light. */
const depthMargin = (texel: number, slope: number) => texel * PCF_REACH * slope;
const normalOffset = (texel: number) => texel * LIGHT_SETTINGS.shadowNormalOffsetTexels;

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
  const edge = (v: number) => (side > 0 ? clamp(v, 0.5, side - 0.5) : v);
  let lit = 0;
  for (const [dx, dy] of POISSON_16)
    lit += compare(edge(t[0] + dx), edge(t[1] + dy), stored, reference);
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
      const e = sub(to, from),
        o = sub([u * across[0], u * across[1]], from);
      const det = light[0] * e[1] - e[0] * light[1];
      if (Math.abs(det) < 1e-12) continue;
      const s = (e[0] * o[1] - e[1] * o[0]) / det,
        k = (light[0] * o[1] - o[0] * light[1]) / det;
      if (k >= 0 && k <= 1) first = Math.min(first, s);
    }
    return first;
  };
  return (index: number, x: number) => {
    const { from, to, normal } = faces[index];
    const P = along(from, sub(to, from), x);
    const cosine = clamp(-dot(normal, light), 1e-3, 1);
    const Q = along(P, normal, normalOffset(texel));
    const reference = dot(Q, light) - depthMargin(texel, Math.sqrt(1 - cosine ** 2) / cosine);
    return pcf([dot(Q, across) / texel, 0.5], (cx) => stored(cx * texel), reference);
  };
}

/** `pointFaceOf`: the major axis of the light-to-point direction, in `POINT_FACE_AXES` order. */
function pointFaceOf(d: Vec) {
  const [x, y, z] = d.map(Math.abs);
  if (x >= y && x >= z) return d[0] > 0 ? 0 : 1;
  if (y >= z) return d[1] > 0 ? 2 : 3;
  return d[2] > 0 ? 4 : 5;
}

/**
 * A point light at `at` over `planes` (a point of each and its normal), its six faces composed by
 * `writeFace` as the record holds them. Returns `lampShadowFactor` at `mip` for the point `P` of
 * normal `N`: the offset point's place in the face it read, and the lit fraction — the map
 * holding, at each texel, the depth along the face's axis of the first plane its ray meets.
 */
export function pointLampOver(at: Vec, planes: { at: Vec; normal: Vec }[]) {
  const light = { id: 'lamp', kind: 'point', position: at, range: 20 } as unknown as SceneLight;
  const m = new Float32Array(6 * 16);
  const frames = Array.from({ length: 6 }, (_, face) => {
    writeFace(m, face * 16, null, 0, light, face);
    return Array.from(faceBasis);
  });
  const tan = Math.tan(writeFace(m, 0, null, 0, light, 0).halfFov);
  const stored = (face: number, a: number, b: number) => {
    const f = frames[face],
      ray = [0, 1, 2].map((i) => f[6 + i] + a * tan * f[i] + b * tan * f[3 + i]);
    let first = Infinity;
    for (const plane of planes) {
      const s = dot(plane.normal, sub(plane.at, at)) / dot(plane.normal, ray);
      if (s > 0) first = Math.min(first, s);
    }
    return first;
  };
  return (P: Vec, N: Vec, mip: number) => {
    const radius = Math.hypot(...sub(P, at)),
      cosine = clamp(-dot(N, sub(P, at)) / radius, 1e-3, 1);
    const texel = ((2 * tan * radius) / (LAMP_SIDE * SHADOW_PAGE)) * 2 ** mip;
    const Q = along(P, N, normalOffset(texel)),
      d = sub(Q, at);
    const face = pointFaceOf(d),
      o = face * 16,
      matrix = m.subarray(o, o + 16);
    const [x, y, , w] = transformHomogeneousPoint([0, 0, 0, 0], matrix, Q[0], Q[1], Q[2]);
    const ndc = [x / w, y / w],
      side = (LAMP_SIDE >> mip) * SHADOW_PAGE;
    const facing = dot(N, [m[o + 3], m[o + 7], m[o + 11]]);
    const slope = Math.sqrt(Math.max(1 - facing * facing, 0)) / cosine;
    // The shader's margin in depth, `k/|d|²` per metre, brought back to the axial metres the map
    // stores: `w²/k` of depth per unit — the near and far planes cancel.
    const margin = (depthMargin(texel, slope) * w * w) / dot(d, d);
    const t = [(ndc[0] * 0.5 + 0.5) * side, (0.5 - ndc[1] * 0.5) * side];
    const map = (cx: number, cy: number) => stored(face, (2 * cx) / side - 1, 1 - (2 * cy) / side);
    return { ndc, lit: pcf(t, map, w - margin, side) };
  };
}
