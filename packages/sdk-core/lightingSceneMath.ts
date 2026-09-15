import type { Vec3 } from './lightingSceneTypes.ts';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (v: Vec3, factor: number): Vec3 => [
  v[0] * factor,
  v[1] * factor,
  v[2] * factor,
];
export const subtract = (a: Vec3, b: Vec3): Vec3 => add(a, scale(b, -1));
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** `Math.hypot(a, b, c)` : l'étalement d'un `Vec3` allouait un tableau d'arguments par longueur. */
export const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
export const normalized = (v: Vec3): Vec3 => scale(v, 1 / length(v));
export const BLACK: Vec3 = [0, 0, 0];
