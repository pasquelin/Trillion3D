import { TAU } from '../../../../math/src/constants.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE DIRECTIONS THE AIR SUMS OVER THE SPHERE: a grid of `side × side` cells over the sphere's
 * height and turn, one direction in each, jittered by a generator whose seed and steps are fixed, so
 * that the directions are the same on every device and every run. The multiple scattering sums them
 * (the first 8 of its 64, in its high-quality form) and so does the sky's mean radiance for the fog.
 *
 * The generator is a linear congruence on 32 bits, `seed ← seed · 196314165 + 907633515`, its
 * fraction the top 23 bits of the seed as the mantissa of a number in [1, 2) less 1. The cell
 * `(i, j)` draws its height from `i` first, then its turn from `j`; its direction is stored at
 * `j · side + i`.
 */
const SEED = 0xde4dc0de

/** The directions of the `side × side` cells, three floats each: x, y, and z the height. */
function stratifiedSphere(side: number) {
  const out = new Float32Array(side * side * 3)
  const inverse = Math.fround(1 / side)
  let seed = SEED >>> 0
  const fraction = () => {
    seed = (Math.imul(seed, 196314165) + 907633515) >>> 0
    return (seed >>> 9) / 8388608
  }
  for (let i = 0; i < side; i++)
    for (let j = 0; j < side; j++) {
      const u0 = Math.fround(Math.fround(i + fraction()) * inverse)
      const u1 = Math.fround(Math.fround(j + fraction()) * inverse)
      const height = 1 - 2 * u0
      const ring = Math.sqrt(1 - height * height)
      const turn = TAU * u1
      out.set([ring * Math.cos(turn), ring * Math.sin(turn), height], (j * side + i) * 3)
    }
  return out
}

/** The directions per side of the grid the air sums: 8 × 8, one per thread of a group. */
const SPHERE_SIDE = 8
/** The directions the air sums. */
const SPHERE_DIRECTIONS = SPHERE_SIDE * SPHERE_SIDE

/** A number as a WGSL float literal. */
const literal = (value: number) => {
  const text = value.toPrecision(9)
  return /[.e]/.test(text) ? text : `${text}.0`
}

/** The directions as a constant array, `SPHERE_DIRECTION[n]`, z up (the table frame's up). */
export const SPHERE_DIRECTIONS_WGSL = /* @__PURE__ */ (() => {
  const all = stratifiedSphere(SPHERE_SIDE)
  const vectors = Array.from(
    { length: SPHERE_DIRECTIONS },
    (_, n) => `vec3f(${literal(all[n * 3])},${literal(all[n * 3 + 1])},${literal(all[n * 3 + 2])})`,
  )
  return wgslBlock(
    'SPHERE_DIRECTIONS_WGSL',
    [],
    `const SPHERE_DIRECTION:array<vec3f,${SPHERE_DIRECTIONS}>=array<vec3f,${SPHERE_DIRECTIONS}>(${vectors.join(',')});`,
  )
})()
