/**
 * The shapes a math value is read or written through. A member that takes one of these takes any
 * object carrying the fields — a vector, a colour's channels, a page's own record —, and a member
 * that writes into a sink calls its `set`.
 */
export type XYLike = { x: number; y: number };
export type XYZLike = { x: number; y: number; z: number };
export type XYZWLike = { x: number; y: number; z: number; w: number };
/** Three angles and the order they apply in (`Euler`). */
export type EulerLike = XYZLike & { order: string };
export type XYZSink = XYZLike & { set(x: number, y: number, z: number): unknown };
export type XYZWSink = XYZWLike & { set(x: number, y: number, z: number, w: number): unknown };
