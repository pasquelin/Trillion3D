// The f32 dot and cross products of three components, every product and sum rounded
// (`Math.fround`) in the shader's order: the one model the CPU oracles of the shaders replay.

type Vec3 = ArrayLike<number>
const f = Math.fround

/** The cross product of `a` and `b`. */
export const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  f(f(a[1] * b[2]) - f(a[2] * b[1])),
  f(f(a[2] * b[0]) - f(a[0] * b[2])),
  f(f(a[0] * b[1]) - f(a[1] * b[0])),
]

/** The dot product of `a` and `b`. */
export const dot = (a: Vec3, b: Vec3): number =>
  f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]))
