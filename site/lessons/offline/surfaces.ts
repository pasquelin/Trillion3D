import { surface, box, combine, fromSolid } from './mesh.ts';
import { geometry, math } from '../../../packages/sdk-browser/index.ts';
const tau = 2 * Math.PI;
export function terrain(detail = 24, amplitude = 1) {
  return surface(detail, detail, (u, v) => [
    (u - 0.5) * 6,
    amplitude * Math.sin(u * 9) * Math.cos(v * 7) * 0.45,
    (v - 0.5) * 6,
  ]);
}
/** A twisted revolution: `geometry.lathe` has no twist term, so this stays a general parametric
 *  surface rather than a lathe call. */
export function loft(twist = 0.7) {
  return surface(48, 24, (u, v) => {
    const a = u * tau + v * twist,
      r = 0.6 + 0.35 * Math.sin(v * Math.PI);
    return [r * Math.cos(a), v * 3 - 1.5, r * Math.sin(a)];
  });
}
/** The wobble's centreline, revolved by the engine's own tube sweep — a proper cross-section
 *  frame along the path, not the naive Y/Z offset the original hand-rolled version used. */
export function splineTube(bend = 1) {
  const points: [number, number, number][] = [];
  for (let step = 0; step <= 64; step++) {
    const u = step / 64;
    points.push([(u - 0.5) * 5, bend * Math.sin(u * tau), 0]);
  }
  return fromSolid(geometry.tube(math.curve(points), 64, 0.18, 12, false));
}
export function rationalPatch(weight = 2) {
  const basis = (t: number) => [(1 - t) ** 2, 2 * t * (1 - t), t * t];
  return surface(24, 24, (u, v) => {
    const bu = basis(u),
      bv = basis(v),
      p = [0, 0, 0];
    let total = 0;
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const w = bu[i] * bv[j] * (i === 1 && j === 1 ? weight : 1);
        const q = [(i - 1) * 3, i === 1 && j === 1 ? 3 : 0, (j - 1) * 3];
        q.forEach((x, k) => (p[k] += w * x));
        total += w;
      }
    return p.map((x) => x / total);
  });
}
/** An axisymmetric profile revolved by the engine's own lathe, rather than sampling the
 *  revolution as a generic parametric surface. */
export function vessel(width = 1) {
  const profile: [number, number][] = [];
  for (let step = 0; step <= 24; step++) {
    const v = step / 24;
    const r = width * (0.35 + 0.5 * Math.sin(v * Math.PI) + 0.1 * Math.cos(v * 3 * Math.PI));
    profile.push([r, 3 * v - 1.5]);
  }
  return fromSolid(geometry.lathe(profile, 48));
}
export function city(rows = 5) {
  return combine(
    Array.from({ length: rows * rows }, (_, i) => {
      const x = i % rows,
        z = Math.floor(i / rows),
        h = 0.5 + ((x * 7 + z * 11) % 9) * 0.23;
      return box([(x - (rows - 1) / 2) * 1.2, h / 2, (z - (rows - 1) / 2) * 1.2], [0.8, h, 0.8]);
    }),
  );
}
export function sculpture(strength = 0.5) {
  return surface(48, 24, (u, v) => {
    const a = u * tau,
      b = 0.02 + v * (Math.PI - 0.04),
      r = 1 + strength * Math.exp(-((u - 0.35) ** 2 + (v - 0.5) ** 2) * 60);
    return [r * Math.sin(b) * Math.cos(a), r * Math.cos(b), r * Math.sin(b) * Math.sin(a)];
  });
}
