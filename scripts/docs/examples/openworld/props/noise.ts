/**
 * Stateless seeded noise for props: a value depends only on the seed and its integer keys, so a
 * shape jittered twice comes out byte-identical, and two copies of one corner (a flat-shaded
 * face's own vertices) move together without opening a crack.
 */
import type { MeshPart, Vec3 } from '../plan/contract.ts';
import { deform } from './geometry.ts';

/** A number in [0, 1) from `seed` and up to three integer keys (a 32-bit integer hash). */
export function hash01(seed: number, a: number, b = 0, c = 0): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(a | 0, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 16), 0x2c1b3c6d) ^ Math.imul(c | 0, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

/** A number in [min, max) from `seed` and one key. */
export const between = (seed: number, key: number, min: number, max: number) =>
  min + (max - min) * hash01(seed, key);

/**
 * Every vertex displaced by up to `amount` metres per axis (`amount` may differ per axis),
 * keyed on its position to the millimetre: identical positions move identically.
 */
export function jitter(part: MeshPart, amount: number | Vec3, seed: number): MeshPart {
  const [ax, ay, az] = typeof amount === 'number' ? [amount, amount, amount] : amount;
  return deform(part, ([x, y, z]) => {
    const [i, j, k] = [x, y, z].map((v) => Math.round(v * 1000));
    return [
      x + ax * (hash01(seed, i, j, k) * 2 - 1),
      y + ay * (hash01(seed + 1, i, j, k) * 2 - 1),
      z + az * (hash01(seed + 2, i, j, k) * 2 - 1),
    ];
  });
}

/** Smooth value noise in [-1, 1] at a point, lattice of 1 m, seeded. */
export function valueNoise(seed: number, [x, y, z]: Vec3): number {
  const [i, j, k] = [Math.floor(x), Math.floor(y), Math.floor(z)],
    fade = (t: number) => t * t * (3 - 2 * t),
    [u, v, w] = [fade(x - i), fade(y - j), fade(z - k)],
    at = (a: number, b: number, c: number) => hash01(seed, i + a, j + b, k + c) * 2 - 1,
    mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return mix(
    mix(mix(at(0, 0, 0), at(1, 0, 0), u), mix(at(0, 1, 0), at(1, 1, 0), u), v),
    mix(mix(at(0, 0, 1), at(1, 0, 1), u), mix(at(0, 1, 1), at(1, 1, 1), u), v),
    w,
  );
}

/** Fractal noise: `octaves` of value noise, each twice as fine and half as strong, about ±1. */
export function fractalNoise(seed: number, p: Vec3, octaves = 4): number {
  let sum = 0,
    scale = 1,
    weight = 0.5;
  for (let o = 0; o < octaves; o++) {
    sum += weight * valueNoise(seed + o * 7919, [p[0] * scale, p[1] * scale, p[2] * scale]);
    scale *= 2;
    weight *= 0.5;
  }
  return sum * 1.07;
}
