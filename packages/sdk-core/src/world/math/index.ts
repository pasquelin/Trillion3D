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
  /**
   * A point or arrow in 2D.
   * @param x - Left to right.
   * @param y - Bottom to top.
   */
  vector2: (x?: number, y?: number) => new Vector2(x, y),
  /**
   * A point or arrow in 3D.
   * @param x - Left to right.
   * @param y - Bottom to top.
   * @param z - Back to front.
   */
  vector3: (x?: number, y?: number, z?: number) => new Vector3(x, y, z),
  /**
   * Four numbers together, like a 3D point with a weight.
   * @param x - The first number.
   * @param y - The second number.
   * @param z - The third number.
   * @param w - The fourth number.
   */
  vector4: (x?: number, y?: number, z?: number, w?: number) => new Vector4(x, y, z, w),
  /** A 3×3 grid of numbers, starting as the identity. */
  matrix3: () => new Matrix3(),
  /** A 4×4 grid of numbers that moves, turns and stretches points. */
  matrix4: () => new Matrix4(),
  /**
   * A rotation stored as four numbers, safe to blend.
   * @param x - The axis part, x.
   * @param y - The axis part, y.
   * @param z - The axis part, z.
   * @param w - The angle part.
   */
  quaternion: (x?: number, y?: number, z?: number, w?: number) => new Quaternion(x, y, z, w),
  /**
   * A rotation stored as three angles.
   * @param x - Turn around x, in radians.
   * @param y - Turn around y, in radians.
   * @param z - Turn around z, in radians.
   * @param order - The order the turns apply in.
   */
  euler: (x?: number, y?: number, z?: number, order?: string) => new Euler(x, y, z, order),
  /**
   * A box lined up with the axes, from two corners.
   * @param min - The lowest corner.
   * @param max - The highest corner.
   */
  box3: (min?: Vector3, max?: Vector3) => new Box3(min?.clone(), max?.clone()),
  /**
   * A ball: a centre and a radius.
   * @param center - The middle.
   * @param radius - The distance to the edge.
   */
  sphere: (center?: Vector3, radius?: number) => new Sphere(center?.clone(), radius),
  /**
   * A flat surface that goes on forever.
   * @param normal - The way it faces.
   * @param constant - Its distance from the origin.
   */
  plane: (normal?: Vector3, constant?: number) => new Plane(normal?.clone(), constant),
  /**
   * A half-line: a start and a direction.
   * @param origin - Where it starts.
   * @param direction - Which way it goes.
   */
  ray: (origin?: Vector3, direction?: Vector3) => new Ray(origin?.clone(), direction?.clone()),
  /**
   * A triangle from three corners.
   * @param a - The first corner.
   * @param b - The second corner.
   * @param c - The third corner.
   */
  triangle: (a?: Vector3, b?: Vector3, c?: Vector3) =>
    new Triangle(a?.clone(), b?.clone(), c?.clone()),
  /** The six planes around what a camera sees. */
  frustum: () => new Frustum(),
  /**
   * A colour from a number, a CSS name or another colour.
   * @param c - A number like `0xff8800`, a CSS name or another colour.
   */
  color: (c?: ColorInput) => new Color(c),
  /**
   * A direction as two angles and a distance.
   * @param radius - The distance.
   * @param phi - The angle down from straight up.
   * @param theta - The angle around the up axis.
   */
  spherical: (radius?: number, phi?: number, theta?: number) => new Spherical(radius, phi, theta),
  /**
   * A smooth curve through the points.
   * @param points - The points it passes through.
   * @param closed - Joins the end back to the start when true.
   */
  curve: (points: Vec3Input[], closed = false) =>
    new SplineCurve(
      points.map((p) => new Vector3(...readVec3(p))),
      closed,
    ),
  /**
   * Straight segments through the points, 2D points lying in the `z = 0` plane.
   * @param points - The corners, 2D or 3D.
   */
  path: (points: (Vec3Input | readonly [number, number])[]) => new Path(points),
  /**
   * A flat outline to fill or extrude.
   * @param points - The corners of the outline, in 2D.
   */
  shape: (points?: readonly (readonly [number, number])[]) => new Shape(points),
  /**
   * Keeps a number between a lowest and a highest value.
   * @param value - The number to keep in range.
   * @param min - The lowest allowed.
   * @param max - The highest allowed.
   */
  clamp: clampNumber,
  /**
   * The number `t` of the way from `a` to `b`.
   * @param a - The start.
   * @param b - The end.
   * @param t - How far along, 0 to 1.
   */
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  /**
   * Turns degrees into radians.
   * @param d - An angle in degrees.
   */
  degToRad: (d: number) => d * DEG2RAD,
  /**
   * Turns radians into degrees.
   * @param r - An angle in radians.
   */
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
