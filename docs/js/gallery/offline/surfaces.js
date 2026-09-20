import { surface, box, combine } from './mesh.js';
const tau = 2 * Math.PI;
export function terrain(detail = 24, amplitude = 1) {
  return surface(detail, detail, (u, v) => [
    (u - 0.5) * 6,
    amplitude * Math.sin(u * 9) * Math.cos(v * 7) * 0.45,
    (v - 0.5) * 6,
  ]);
}
export function loft(twist = 0.7) {
  return surface(48, 24, (u, v) => {
    const a = u * tau + v * twist,
      r = 0.6 + 0.35 * Math.sin(v * Math.PI);
    return [r * Math.cos(a), v * 3 - 1.5, r * Math.sin(a)];
  });
}
export function splineTube(bend = 1) {
  return surface(64, 12, (u, v) => {
    const a = v * tau,
      x = (u - 0.5) * 5;
    return [x, bend * Math.sin(u * tau) + 0.18 * Math.cos(a), 0.18 * Math.sin(a)];
  });
}
export function rationalPatch(weight = 2) {
  const basis = (t) => [(1 - t) ** 2, 2 * t * (1 - t), t * t];
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
export function vessel(width = 1) {
  return surface(48, 24, (u, v) => {
    const r = width * (0.35 + 0.5 * Math.sin(v * Math.PI) + 0.1 * Math.cos(v * 3 * Math.PI));
    return [r * Math.cos(u * tau), 3 * v - 1.5, r * Math.sin(u * tau)];
  });
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
