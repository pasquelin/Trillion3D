/**
 * THE LINEARLY TRANSFORMED COSINES OF THE ENGINE'S SPECULAR LOBE — fitted, never copied.
 *
 * Heitz, Dupuy, Hill and Neubelt 2016, "Real-time polygonal-light shading with linearly
 * transformed cosines": the GGX lobe times the cosine, for one roughness and one view angle, is
 * approximated by a clamped cosine seen through a 3×3 matrix M. Integrating the lobe over a
 * polygon is then integrating a clamped cosine over the polygon moved by M⁻¹ — a form factor,
 * in closed form. This file fits M, cell by cell, to the engine's OWN lobe: `standardLighting`'s
 * GGX distribution with its height-correlated visibility, Fresnel apart (`standardLighting.ts`).
 *
 * In the frame of the normal (z) with the view in the xz half-plane (x ≥ 0), M is the rotation
 * that takes z to the lobe's mean direction times [[p0, 0, p2], [0, p1, 0], [0, 0, 1]]; the
 * three parameters minimise the cubed difference between the normalised lobe and the
 * transformed cosine, estimated on stratified samples of both (balance heuristic), by
 * Nelder–Mead started from the neighbouring cell. A cell also records the lobe's magnitude
 * ∫ρ·cos and its Schlick share ∫ρ·cos·(1 − v·h)⁵, which the shading weighs by F0.
 *
 * Everything is derived: the lobe is the engine's, the tolerances are float resolutions, and
 * the sample counts only set the fit's precision, which `ltcTable.ts` records with the table.
 */
import { minimise } from './mathMinimise.ts';

type V3 = [number, number, number];
const PI = Math.PI;

const normalize = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** The engine's specular lobe times the cosine, Fresnel at 1: `standardLighting`'s D·Vis·NdotL. */
function lobe(v: V3, l: V3, alpha: number) {
  if (l[2] <= 0) return 0;
  const h = normalize([v[0] + l[0], v[1] + l[1], v[2] + l[2]]);
  const a2 = alpha * alpha,
    nv = Math.max(v[2], 1e-4),
    nl = l[2];
  const dd = h[2] * h[2] * (a2 - 1) + 1;
  const d = a2 / (PI * dd * dd);
  const gv = nl * Math.sqrt(nv * nv * (1 - a2) + a2),
    gl = nv * Math.sqrt(nl * nl * (1 - a2) + a2);
  return d * (0.5 / (gv + gl + 1e-7)) * nl;
}

/** A light direction drawn from the GGX half vectors at (u1, u2), and its density. */
function sampleLobe(v: V3, alpha: number, u1: number, u2: number): [V3, number] {
  const a2 = alpha * alpha;
  const cos2 = (1 - u1) / (1 + (a2 - 1) * u1),
    cosH = Math.sqrt(cos2),
    sinH = Math.sqrt(Math.max(0, 1 - cos2)),
    phi = 2 * PI * u2;
  const h: V3 = [sinH * Math.cos(phi), sinH * Math.sin(phi), cosH];
  const vh = v[0] * h[0] + v[1] * h[1] + v[2] * h[2];
  const l: V3 = [2 * vh * h[0] - v[0], 2 * vh * h[1] - v[1], 2 * vh * h[2] - v[2]];
  return [l, lobeDensity(v, l, alpha)];
}

/** Density of `sampleLobe` at the direction l. */
function lobeDensity(v: V3, l: V3, alpha: number) {
  const h = normalize([v[0] + l[0], v[1] + l[1], v[2] + l[2]]);
  const vh = Math.max(v[0] * h[0] + v[1] * h[1] + v[2] * h[2], 1e-7);
  const a2 = alpha * alpha,
    dd = h[2] * h[2] * (a2 - 1) + 1;
  return ((a2 / (PI * dd * dd)) * Math.max(h[2], 0)) / (4 * vh);
}

type Ltc = { m: number[]; inverse: number[]; det: number };

/** M from the lobe's mean direction and the three parameters; its inverse and determinant. */
function ltcOf(mean: V3, p: number[]): Ltc {
  const x = normalize([mean[2], 0, -mean[0]]);
  // M = [x y mean] · [[p0, 0, p2], [0, p1, 0], [0, 0, 1]]: its xz block and its y scale.
  const a = x[0] * p[0],
    b = x[0] * p[2] + mean[0],
    c = x[2] * p[0],
    d = x[2] * p[2] + mean[2];
  const block = a * d - b * c;
  const m = [a, 0, b, 0, p[1], 0, c, 0, d];
  const inverse = [d / block, 0, -b / block, 0, 1 / p[1], 0, -c / block, 0, a / block];
  return { m, inverse, det: p[1] * block };
}

const apply = (a: number[], v: V3): V3 => [
  a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
  a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
  a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
];

/** Density of the transformed cosine at the unit direction w. */
function ltcDensity(t: Ltc, w: V3) {
  const o = apply(t.inverse, w);
  const l = Math.hypot(o[0], o[1], o[2]);
  if (!(o[2] > 0)) return 0;
  return o[2] / l / PI / Math.abs(t.det) / (l * l * l);
}

/** Stratified cell centres of a side × side grid of the unit square. */
function strata(side: number) {
  const points: [number, number][] = [];
  for (let i = 0; i < side; i++)
    for (let j = 0; j < side; j++) points.push([(i + 0.5) / side, (j + 0.5) / side]);
  return points;
}

/** The cubed difference between the normalised lobe and the transformed cosine. */
function fitError(v: V3, alpha: number, norm: number, t: Ltc, points: [number, number][]) {
  let error = 0;
  for (const [u1, u2] of points) {
    const r = Math.sqrt(u1),
      phi = 2 * PI * u2;
    const fromCosine = normalize(
      apply(t.m, [r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(1 - u1)]),
    );
    const [fromLobe, lobePdf] = sampleLobe(v, alpha, u1, u2);
    for (const [w, own] of [
      [fromCosine, ltcDensity(t, fromCosine)],
      [fromLobe, lobePdf],
    ] as [V3, number][]) {
      const cosine = w === fromCosine ? own : ltcDensity(t, w);
      const density = w === fromLobe ? own : lobeDensity(v, w, alpha);
      if (!(cosine + density > 0)) continue;
      error += Math.abs(lobe(v, w, alpha) / norm - cosine) ** 3 / (cosine + density);
    }
  }
  return error / points.length;
}

/**
 * The table: `size × size` cells, roughness along the row (0 to 1) and √(1 − cos θ_v) down the
 * columns, each two vec4 — M⁻¹'s free entries over its middle one (m00, m02, m20, m22), then the
 * lobe's magnitude and Schlick share. `side` is the per-axis count of the stratified samples.
 */
export function fitLtcTable(size: number, side: number) {
  const table = new Float32Array(size * size * 8);
  const points = strata(side);
  let previous = [1, 1, 0];
  for (let r = size - 1; r >= 0; r--) {
    const alpha = Math.max((r / (size - 1)) ** 2, 1e-4);
    let start = previous;
    for (let c = 0; c < size; c++) {
      const s = c / (size - 1),
        cosV = Math.max(1 - s * s, 1e-4);
      const v: V3 = [Math.sqrt(1 - cosV * cosV), 0, cosV];
      let norm = 0,
        schlick = 0;
      const mean: V3 = [0, 0, 0];
      for (const [u1, u2] of points) {
        const [l, pdf] = sampleLobe(v, alpha, u1, u2);
        const weight = pdf > 0 ? lobe(v, l, alpha) / pdf : 0;
        const h = normalize([v[0] + l[0], v[1] + l[1], v[2] + l[2]]);
        norm += weight;
        schlick += weight * (1 - Math.max(v[0] * h[0] + v[1] * h[1] + v[2] * h[2], 0)) ** 5;
        for (let k = 0; k < 3; k++) mean[k] += weight * l[k];
      }
      norm /= points.length;
      schlick /= points.length;
      const axis = normalize([mean[0], 0, Math.max(mean[2], 1e-4)]);
      const fitted = minimise(
        (p) => (p[0] > 0 && p[1] > 0 ? fitError(v, alpha, norm, ltcOf(axis, p), points) : Infinity),
        start,
        Math.max(0.05 * start[0], 1e-4),
      );
      if (c === 0) previous = fitted;
      start = fitted;
      const inverse = ltcOf(axis, fitted).inverse,
        middle = inverse[4],
        at = (r + c * size) * 8;
      table.set(
        [inverse[0] / middle, inverse[2] / middle, inverse[6] / middle, inverse[8] / middle],
        at,
      );
      table.set([norm, schlick, 0, 0], at + 4);
    }
  }
  return table;
}
