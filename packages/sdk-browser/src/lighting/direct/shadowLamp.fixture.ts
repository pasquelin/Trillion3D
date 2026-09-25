// `lampShadowFactor`, restated for the tests of #456 over the kernel's own face matrices: the
// lines it restates are pinned with the sun's in `shadowBias.fixture.ts`'s `RESTATED`.
import { type SceneLight } from '../../../../sdk-core/src/index.ts';
import { dot } from '../../../../sdk-core/src/math/projectionOracles.ts';
import { transformHomogeneousPoint } from '../../../../sdk-core/src/math/primitives/vector.ts';
import { writeFace } from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { faceBasis } from '../../../../sdk-core/src/scene/light-shadow/math.ts';
import { LAMP_SIDE, SHADOW_PAGE } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { clampNumber as clamp } from '../../../../sdk-core/src/world/math/spherical.ts';
import { SHADOW_DEPTH_ROUNDING } from './shadowFactorWgsl.ts';
import { DEVELOP_BIAS, along, depthMargin, normalOffset, pcf, sub } from './shadowBias.fixture.ts';
import type { Vec } from './shadowBias.fixture.ts';

/** `pointFaceOf`: the major axis of the light-to-point direction, in `POINT_FACE_AXES` order. */
function pointFaceOf(d: Vec) {
  const [x, y, z] = d.map(Math.abs);
  if (x >= y && x >= z) return d[0] > 0 ? 0 : 1;
  if (y >= z) return d[1] > 0 ? 2 : 3;
  return d[2] > 0 ? 4 : 5;
}

/** A lamp of 20 m range at `at`: a point light, or a spot along `direction` of cone `coneAngle`. */
export const lampAt = (at: Vec, direction?: Vec, coneAngle?: number) =>
  ({
    id: 'lamp',
    kind: direction ? 'spot' : 'point',
    position: at,
    range: 20,
    direction,
    coneAngle,
  }) as unknown as SceneLight;

/**
 * A lamp over `planes` (a point of each and its normal), its faces — six for a point light, one
 * for a spot — composed by `writeFace` as the record holds them. Returns `lampShadowFactor` at
 * `mip` for the point `P` of normal `N`: the offset point's place in the face it read, and the lit
 * fraction — the map holding, at each texel, the depth along the face's axis of the first plane
 * its ray meets. `develop` reads as develop did before #456: its bias, the face of `P`, and full
 * light off that face.
 */
export function lampOver(light: SceneLight, planes: { at: Vec; normal: Vec }[], develop = false) {
  const at = light.position!,
    point = light.kind === 'point',
    m = new Float32Array(6 * 16);
  let tan = 0,
    k = 0;
  const frames = Array.from({ length: point ? 6 : 1 }, (_, face) => {
    const { halfFov, near, far } = writeFace(m, face * 16, null, 0, light, face);
    tan = Math.tan(halfFov);
    k = (near * far) / (far - near);
    return Array.from(faceBasis);
  });
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
    const [old, metres] = develop ? DEVELOP_BIAS(texel, cosine) : [];
    const Q = along(P, N, develop ? old : normalOffset(texel, cosine)),
      d = sub(Q, at);
    const face = point ? pointFaceOf(develop ? sub(P, at) : d) : 0,
      o = face * 16,
      matrix = m.subarray(o, o + 16);
    const [x, y, , w] = transformHomogeneousPoint([0, 0, 0, 0], matrix, Q[0], Q[1], Q[2]);
    const ndc = [x / w, y / w],
      side = (LAMP_SIDE >> mip) * SHADOW_PAGE;
    const facing = dot(N, [m[o + 3], m[o + 7], m[o + 11]]);
    const slope = Math.sqrt(Math.max(1 - facing * facing, 0)) / (dot(d, d) * cosine);
    // The shader adds `k·margin` to a depth of `k/w` plus a constant: in the axial metres the map
    // stores, the reference is `1/(1/w + margin)`, the margin `w²·margin` only to first order.
    if (develop && Math.max(Math.abs(ndc[0]), Math.abs(ndc[1])) > 1) return { ndc, lit: 1 };
    const margin = develop
      ? metres / (w * w)
      : depthMargin(texel, slope, 1 / (w * w)) + SHADOW_DEPTH_ROUNDING / k;
    const reference = 1 / (1 / w + margin);
    const t = [(ndc[0] * 0.5 + 0.5) * side, (0.5 - ndc[1] * 0.5) * side];
    const map = (cx: number, cy: number) => stored(face, (2 * cx) / side - 1, 1 - (2 * cy) / side);
    return { ndc, lit: pcf(t, map, reference, side) };
  };
}
