import { TAU } from '../../../../../../math/src/constants.ts'

/**
 * The factors of a Fourier transform of `n` values, computed once in double precision on the CPU:
 * the transform of a line reads `exp(−2πi k / n)` for k from 0 to n/2 − 1, and a transform of a
 * shorter line reads every `n / length`-th of them. A table is exact to the float, where the
 * device's own sine and cosine of an angle are good to a few parts in a million, which a halo a
 * hundred thousandth of the centre's light would drown in.
 * @returns the real and imaginary part of each factor, interleaved.
 */
export function twiddleTable(n: number) {
  const table = new Float32Array(n)
  for (let k = 0; k < n / 2; k++) {
    const angle = (-TAU * k) / n
    table[2 * k] = Math.cos(angle)
    table[2 * k + 1] = Math.sin(angle)
  }
  return table
}
