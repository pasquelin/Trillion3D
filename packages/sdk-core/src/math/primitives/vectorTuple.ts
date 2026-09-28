import { crossVector3, normalizeVector3, subVector3 } from './vector.ts';

type Vec3 = [number, number, number];

/** A difference in a fresh tuple, accepting arrays and typed-array inputs. */
export const subtract = (a: ArrayLike<number>, b: ArrayLike<number>): Vec3 =>
  subVector3<Vec3>([0, 0, 0], a, b);
/** A cross product in a fresh tuple. */
export const cross = (a: Vec3, b: Vec3): Vec3 => crossVector3<Vec3>([0, 0, 0], a, b);

/** A tuple normalized in place and returned without another allocation. */
export const unit = (v: Vec3): Vec3 => {
  normalizeVector3(v);
  return v;
};
