/** One float32 and its bits, the buffer `f32Bits` reads through. */
const f32 = new Float32Array(1),
  u32 = new Uint32Array(f32.buffer)

/** The 32 bits of `x` as a `Float32Array` stores it: rounded once to single precision. */
export function f32Bits(x: number) {
  f32[0] = x
  return u32[0]
}
