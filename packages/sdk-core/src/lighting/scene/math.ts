import type { Vec3 } from './types.ts';
import {
  addVector3,
  copyScaledVector3,
  crossVector3,
  subVector3,
} from '../../math/primitives/vector.ts';
import { hypot3 } from '../../math/primitives/hypot.ts';

export const add = (a: Vec3, b: Vec3): Vec3 => addVector3<Vec3>([0, 0, 0], a, b);
export const scale = (v: Vec3, factor: number): Vec3 =>
  copyScaledVector3<Vec3>([0, 0, 0], v, factor);
export const subtract = (a: Vec3, b: Vec3): Vec3 => subVector3<Vec3>([0, 0, 0], a, b);
export const cross = (a: Vec3, b: Vec3): Vec3 => crossVector3<Vec3>([0, 0, 0], a, b);
/** `Math.hypot(a, b, c)` to the bit, without the builtin's arguments array (`hypot3`). */
export const length = (v: Vec3): number => hypot3(v[0], v[1], v[2]);
export const normalized = (v: Vec3): Vec3 => scale(v, 1 / length(v));
export const BLACK: Vec3 = [0, 0, 0];
