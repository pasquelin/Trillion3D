import { DEG2RAD, clampNumber } from './spherical.ts';
import { Vector2, Vector4, Spherical } from './vector2.ts';
import { Vector3, readVec3, type Vec3Input } from './vector3.ts';
import { Matrix3, Matrix4 } from './matrix4.ts';
import { Quaternion } from './quaternion.ts';
import { Euler } from './euler.ts';
import { Box3 } from './box3.ts';
import { Frustum, Plane, Ray, Sphere, Triangle } from './volumes.ts';
import { Color, type ColorInput } from './color.ts';
import { Path, Shape, SplineCurve } from './curves.ts';

/** The `math` family: the value types of a scene, each built by the member named after it. */
export const math = {
  vector2: (x?: number, y?: number) => new Vector2(x, y),
  vector3: (x?: number, y?: number, z?: number) => new Vector3(x, y, z),
  vector4: (x?: number, y?: number, z?: number, w?: number) => new Vector4(x, y, z, w),
  matrix3: () => new Matrix3(),
  matrix4: () => new Matrix4(),
  quaternion: (x?: number, y?: number, z?: number, w?: number) => new Quaternion(x, y, z, w),
  euler: (x?: number, y?: number, z?: number, order?: string) => new Euler(x, y, z, order),
  box3: (min?: Vector3, max?: Vector3) => new Box3(min?.clone(), max?.clone()),
  sphere: (center?: Vector3, radius?: number) => new Sphere(center?.clone(), radius),
  plane: (normal?: Vector3, constant?: number) => new Plane(normal?.clone(), constant),
  ray: (origin?: Vector3, direction?: Vector3) => new Ray(origin?.clone(), direction?.clone()),
  triangle: (a?: Vector3, b?: Vector3, c?: Vector3) =>
    new Triangle(a?.clone(), b?.clone(), c?.clone()),
  frustum: () => new Frustum(),
  color: (c?: ColorInput) => new Color(c),
  spherical: (radius?: number, phi?: number, theta?: number) => new Spherical(radius, phi, theta),
  /** A smooth curve through the points. */
  curve: (points: Vec3Input[], closed = false) =>
    new SplineCurve(
      points.map((p) => new Vector3(...readVec3(p))),
      closed,
    ),
  /** Straight segments through the points, 2D points lying in the `z = 0` plane. */
  path: (points: (Vec3Input | readonly [number, number])[]) => new Path(points),
  shape: (points?: readonly (readonly [number, number])[]) => new Shape(points),
  clamp: clampNumber,
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  degToRad: (d: number) => d * DEG2RAD,
  radToDeg: (r: number) => r / DEG2RAD,
};

export {
  Vector2,
  Vector3,
  Vector4,
  Spherical,
  Matrix3,
  Matrix4,
  Quaternion,
  Euler,
  Box3,
  Sphere,
  Plane,
  Ray,
  Triangle,
  Frustum,
  Color,
  Path,
  Shape,
  SplineCurve,
};
export { Curve } from './curves.ts';
export type { ColorInput, Vec3Input };
export type { BoundedNode } from './box3.ts';
export type { EulerLike, XYLike, XYZLike, XYZSink, XYZWLike, XYZWSink } from './likes.ts';
