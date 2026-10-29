import type { Vec3 } from './distanceFieldScene.ts'

/**
 * THE DIRECTIONS OF A VOXEL'S RAYS (`asset-compiler-rust/src/distance_field/samples.rs`, which this follows step by step): 49 stratified
 * samples of a hemisphere and 49 of the other, drawn from the stream seeded with 0.
 */

const f = Math.fround
/** The samples of one hemisphere: the sides of its stratified square, squared. */
const SAMPLES = 49

/** The next fraction of the stream `state` (`lcg32_fraction`): the new state's top 23 bits the mantissa of a number in [1, 2), less one. */
function lcgFraction(state: { value: number }) {
  state.value = (Math.imul(state.value, 196314165) + 907633515) >>> 0
  const bits = new Uint32Array([0x3f800000 | (state.value >>> 9)])
  return new Float32Array(bits.buffer)[0] - 1
}

/** The point of the unit hemisphere (+z) a square's point in [0, 1]² maps to: the concentric disk, lifted (`hemisphere_point`). */
function hemispherePoint(u0: number, u1: number): Vec3 {
  const x = u0 * 2 - 1,
    y = u1 * 2 - 1
  if (x === 0 && y === 0) return [0, 0, 0]
  const quarter = f(Math.PI)
  let radius: number, angle: number
  if (Math.abs(x) > Math.abs(y)) {
    radius = f(x)
    angle = f(f(quarter / 4) * f(y / x))
  } else {
    radius = f(y)
    angle = f(f(quarter / 2) - f(f(quarter / 4) * f(x / y)))
  }
  const u = f(radius * Math.cos(angle)),
    v = f(radius * Math.sin(angle))
  const r2 = f(radius * radius)
  const lift = f(Math.sqrt(f(2 - r2)))
  return [f(u * lift), f(v * lift), f(1 - r2)]
}

/** The 49 stratified samples of a hemisphere and 49 of the other, drawn from the stream seeded with 0, as doubles. */
export function distanceFieldDirections(): Vec3[] {
  const state = { value: 0 }
  const side = Math.trunc(f(Math.sqrt(SAMPLES)))
  const stratified = () => {
    const samples: Vec3[] = []
    for (let x = 0; x < side; x++)
      for (let y = 0; y < side; y++) {
        const u1 = lcgFraction(state),
          u2 = lcgFraction(state)
        samples.push(hemispherePoint(f(f(x + u1) / side), f(f(y + u2) / side)))
      }
    return samples
  }
  const upper = stratified()
  const lower = stratified().map(([x, y, z]): Vec3 => [x, y, -z])
  return [...upper, ...lower]
}
