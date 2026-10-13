// The f32 dot and cross products of three components, every product and sum rounded
// (`Math.fround`) in the shader's order: the one model the CPU oracles of the shaders replay.

type Vec3 = ArrayLike<number>

/** The cross product of `a` and `b`. */
export const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  Math.fround(Math.fround(a[1] * b[2]) - Math.fround(a[2] * b[1])),
  Math.fround(Math.fround(a[2] * b[0]) - Math.fround(a[0] * b[2])),
  Math.fround(Math.fround(a[0] * b[1]) - Math.fround(a[1] * b[0])),
]

/** The dot product of `a` and `b`. */
export const dot = (a: Vec3, b: Vec3): number =>
  Math.fround(
    Math.fround(Math.fround(a[0] * b[0]) + Math.fround(a[1] * b[1])) + Math.fround(a[2] * b[2]),
  )
