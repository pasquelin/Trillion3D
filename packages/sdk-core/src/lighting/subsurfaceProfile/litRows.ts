import { fromHalf } from '../../../../math/src/float/half.ts'
import { PROFILE_COLUMNS, PROFILE_TABLE_WIDTH } from './table.ts'

/**
 * WHAT THE LIGHTS READ OF A PROFILE'S ROW, as the light buffer holds it (`packages/sdk-browser/src/lighting/subsurface/litRows.ts`): the
 * dual specular's texel of the profile table (`PROFILE_COLUMNS.dualSpecular`: the two lobes' roughness scales over the largest, and their
 * mix), four floats, a row after the other; and its transmission's (`litTransmissionRows`): the table's transmission texel (the
 * extinction scale, the normal scale, the scattering distribution and the inverse index of refraction, as the table encodes them) then the
 * transmission profile's samples, `LIT_TRANSMISSION_VEC4S` floats of four a row.
 */

/** The rows the light buffer holds: the table's most. */
export const LIT_PROFILE_ROWS = 256

/** The `vec4`s a row of the transmission rows holds: the transmission texel, then the samples of the transmission profile. */
export const LIT_TRANSMISSION_VEC4S = 1 + PROFILE_COLUMNS.transmissionProfileSize

/** The transmission texel and the transmission profile of each row of the table `halves` (`buildProfileTable`), four floats a texel. */
export function litTransmissionRows(halves: Uint16Array) {
  const rows = halves.length / (PROFILE_TABLE_WIDTH * 4)
  const out = new Float32Array(rows * LIT_TRANSMISSION_VEC4S * 4)
  for (let row = 0; row < rows; row++) {
    const texel = (at: number, k: number) =>
      fromHalf(halves[(row * PROFILE_TABLE_WIDTH + at) * 4 + k]!)
    for (let k = 0; k < 4; k++)
      out[row * LIT_TRANSMISSION_VEC4S * 4 + k] = texel(PROFILE_COLUMNS.transmission, k)
    for (let i = 0; i < PROFILE_COLUMNS.transmissionProfileSize; i++)
      for (let k = 0; k < 4; k++)
        out[(row * LIT_TRANSMISSION_VEC4S + 1 + i) * 4 + k] = texel(
          PROFILE_COLUMNS.transmissionProfile + i,
          k,
        )
  }
  return out
}

/** The dual specular's texel of each row of the table `halves` (`buildProfileTable`), four floats a row. */
export function litProfileRows(halves: Uint16Array) {
  const rows = halves.length / (PROFILE_TABLE_WIDTH * 4)
  const out = new Float32Array(rows * 4)
  for (let row = 0; row < rows; row++) {
    const from = (row * PROFILE_TABLE_WIDTH + PROFILE_COLUMNS.dualSpecular) * 4
    for (let k = 0; k < 4; k++) out[row * 4 + k] = fromHalf(halves[from + k]!)
  }
  return out
}
