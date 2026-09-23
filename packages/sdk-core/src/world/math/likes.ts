// The shapes a math value is read or written through. A member that takes one of these takes any
// object carrying the fields — a vector, a colour's channels, a page's own record —, and a member
// that writes into a sink calls its `set`.

/** Anything with an `x` and a `y`: a 2D point read by its fields. */
export type XYLike = {
  /** The first coordinate. */
  x: number;
  /** The second coordinate. */
  y: number;
};
/** Anything with `x`, `y` and `z`: a 3D point read by its fields. */
export type XYZLike = {
  /** Left to right. */
  x: number;
  /** Bottom to top. */
  y: number;
  /** Back to front. */
  z: number;
};
/** Anything with `x`, `y`, `z` and `w`: a quaternion or a 4D vector read by its fields. */
export type XYZWLike = {
  /** The first number. */
  x: number;
  /** The second number. */
  y: number;
  /** The third number. */
  z: number;
  /** The fourth number. */
  w: number;
};
/** Three angles and the order they apply in (`Euler`). */
export type EulerLike = XYZLike & {
  /** The order the three turns apply in, such as `'XYZ'`. */
  order: string;
};
/** A 3D value the engine writes its answer into, through `set`. */
export type XYZSink = XYZLike & {
  /** Writes the three numbers. */
  set(x: number, y: number, z: number): unknown;
};
/** A four-number value the engine writes its answer into, through `set`. */
export type XYZWSink = XYZWLike & {
  /** Writes the four numbers. */
  set(x: number, y: number, z: number, w: number): unknown;
};
