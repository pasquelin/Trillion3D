// The shadow read of `shadowWgsl.ts` and `shadowFactorWgsl.ts`, restated for the tests of #456:
// the receiver's bias, and the PCF's bilinear comparisons, over a depth map a test describes as
// a function. `RESTATED` holds the WGSL lines restated here; the tests pin them.
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { dot } from '../../../../sdk-core/src/math/projectionOracles.ts';
import { clampNumber as clamp } from '../../../../sdk-core/src/world/math/spherical.ts';
import { DIRECT_LIGHT_WGSL } from './lightWgsl.ts';
import { SHADOW_DEPTH_ROUNDING } from './shadowFactorWgsl.ts';
import { PCF_REACH, POISSON_16, directShadowWgsl } from './shadowWgsl.ts';

export type Vec = readonly number[];
/** The depth map: the distance along the light stored at a texel centre. */
export type Stored = (x: number, y: number) => number;

/** The shading's shadow read as a pass declares it, and the light code it calls. */
export const SHADOW_WGSL = DIRECT_LIGHT_WGSL + directShadowWgsl(8, null, 18);
/** The lines this fixture restates. */
export const RESTATED = [
  ' return SHADOW_NORMAL_TEXELS+SHADOW_PCF_REACH*max(sqrt(1.0-cosine*cosine)-cosine,0.0);',
  'fn shadowDepthMargin(texel:f32,slope:f32,cap:f32)->f32{return texel*SHADOW_PCF_REACH*min(slope,cap);}',
  ' let cosine=clamp(dot(N,-axis),1e-3,1.0);',
  ' let slope=sqrt(1.0-cosine*cosine)/cosine;',
  ' let offset=shadowNormalTexels(cosine);',
  '  let texel=exp2(f32(level));',
  '  let Q=P+N*(texel*offset);\n  // Relative',
  '  let reference=1.0-(dot(Q,axis)-zNear-shadowDepthMargin(texel,slope,1.0))*invDepth+SHADOW_DEPTH_ROUNDING;',
  ' let cosine=clamp(dot(N,L),1e-3,1.0);',
  ' let radius=length(light.positionRange.xyz-P);',
  ' let texel0=2.0*info.y*radius/(f32(LAMP_PAGE_COUNT)*SHADOW_PAGE);',
  ' let k=near*far/(far-near);',
  '  let pages=LAMP_PAGE_COUNT>>mip;',
  '  let side=f32(pages)*SHADOW_PAGE;',
  '  let texel=texel0*exp2(f32(mip));',
  '  let Q=P+N*(texel*offset);\n  let d=Q-light.positionRange.xyz;',
  '  let picked=select(0u,pointFaceOf(d),isPoint);',
  '  if(picked!=face){face=picked;m=shadows.records[index].faces[face];}',
  '  let clip=m*vec4f(Q,1.0);',
  '  let t=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5)*side;',
  '  let facing=dot(N,vec3f(m[0].w,m[1].w,m[2].w));',
  '  let slope=sqrt(max(1.0-facing*facing,0.0))/(dot(d,d)*cosine);',
  '  let reference=ndc.z+k*shadowDepthMargin(texel,slope,1.0/(clip.w*clip.w))+SHADOW_DEPTH_ROUNDING;',
  '  if((!isPoint&&(abs(ndc.x)>1.0||abs(ndc.y)>1.0))||ndc.z<0.0||ndc.z>1.0){return 1.0;}',
  `const SHADOW_DEPTH_ROUNDING:f32=${SHADOW_DEPTH_ROUNDING};`,
  '  if(side>0.0){at=clamp(at,vec2f(0.5),vec2f(side-0.5));}',
  ' if(a.x>=a.y&&a.x>=a.z){return select(1u,0u,direction.x>0.0);}',
  ' if(a.y>=a.z){return select(3u,2u,direction.y>0.0);}',
  ' return select(5u,4u,direction.z>0.0);',
];

export const along = (p: Vec, n: Vec, s: number) => p.map((value, i) => value + n[i] * s);
export const sub = (a: Vec, b: Vec) => a.map((value, i) => value - b[i]);
/** `shadowDepthMargin`, in metres toward the light. */
export const depthMargin = (texel: number, slope: number, cap = 1) =>
  texel * PCF_REACH * Math.min(slope, cap);
/** `shadowNormalTexels` at a texel of `texel` metres: the offset in metres along the normal. */
export const normalOffset = (texel: number, cosine: number) =>
  texel *
  (LIGHT_SETTINGS.shadowNormalOffsetTexels +
    PCF_REACH * Math.max(Math.sqrt(1 - cosine * cosine) - cosine, 0));

const tangent = (cosine: number) => Math.sqrt(1 - cosine * cosine) / cosine;
/** The bias, in metres: along the normal, then toward the light — this branch's, and develop's
 *  before #456 (1.5 texel/max(cos, 0.2); 2 cm + 8 cm·tan, at most 0.5 m), for the proof. */
export type Bias = (texel: number, cosine: number) => number[];
export const BIAS: Bias = (texel, c) => [normalOffset(texel, c), depthMargin(texel, tangent(c))];
export const DEVELOP_BIAS: Bias = (texel, c) => [
  (1.5 * texel) / Math.max(c, 0.2),
  0.02 + Math.min(0.08 * tangent(c), 0.5),
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
  const edge = (v: number) => (side > 0 ? clamp(v, 0.5, side - 0.5) : v);
  let lit = 0;
  for (const [dx, dy] of POISSON_16)
    lit += compare(edge(t[0] + dx), edge(t[1] + dy), stored, reference);
  return litOf(lit);
}

/** A face of a profile extruded along z: a segment of the x-y plane, and its outward normal. */
export type Face = { from: Vec; to: Vec; normal: Vec };

/** A distance along the light as a map `range` metres deep, its near plane at the origin, holds
 *  it: its normalised depth, `1 − s/range`, rounded to float32 — the depth format's rounding. */
const float32Depth = (s: number, range: number) => range * (1 - Math.fround(1 - s / range));

/**
 * A sun `angle` radians from vertical, shining toward +x over a profile of `faces`, read at a
 * texel of `texel` metres, as `sunShadowFactor` reads its level. Returns the lit fraction at the
 * point `x` along face `index` (0 at `from`, 1 at `to`); `truth` asks a ray-cast of the faces
 * instead, 1 lit or 0. In a map `deep` metres deep, both depths round as the depth format does.
 */
export function sunOverProfile(faces: Face[], angle: number, texel: number, deep = 0, bias = BIAS) {
  const depth = (s: number) => (deep ? float32Depth(s, deep) : s);
  const light = [Math.sin(angle), -Math.cos(angle)],
    across = [Math.cos(angle), Math.sin(angle)];
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
  return (index: number, x: number, truth = false) => {
    const { from, to, normal } = faces[index];
    const P = along(from, sub(to, from), x);
    if (truth) return stored(dot(P, across)) < dot(P, light) - 1e-9 ? 0 : 1;
    const [offset, margin] = bias(texel, clamp(-dot(normal, light), 1e-3, 1));
    const Q = along(P, normal, offset);
    const reference = depth(dot(Q, light) - margin) - deep * SHADOW_DEPTH_ROUNDING;
    return pcf([dot(Q, across) / texel, 0.5], (cx) => depth(stored(cx * texel)), reference);
  };
}
