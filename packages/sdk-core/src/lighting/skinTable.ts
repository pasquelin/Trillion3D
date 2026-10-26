/**
 * THE PREINTEGRATED SKIN TABLE, as the file it ships in: the 256 × 256 image a preintegrated-skin
 * surface reads its transmitted light from (`packages/sdk-browser/src/lighting/direct/skinTableWgsl.ts`).
 * The image is the reference engine's own, imported as it is:
 * across, the cosine of the light against the normal mapped to [0, 1] (`N·L / 2 + 1 / 2`); down, one
 * minus the surface's opacity. Its three colour channels are stored in sRGB, as the image was made.
 *
 * The file is `SKIN_TABLE_SIZE²` texels of three bytes (red, green, blue), row after row, the top row first.
 */

/** The table's texels along a side. */
export const SKIN_TABLE_SIZE = 256

/** Texels of the table. */
export const SKIN_TABLE_TEXELS = SKIN_TABLE_SIZE * SKIN_TABLE_SIZE

/** Bytes of the file: three a texel. */
export const SKIN_TABLE_FILE_BYTES = SKIN_TABLE_TEXELS * 3

/** The words the light buffer holds the table as (`SKIN_TABLE_TEXELS` of them): a texel's red in the
 *  low byte, its green and its blue above it. */
export function skinTableWords(file: Uint8Array) {
  if (file.length !== SKIN_TABLE_FILE_BYTES)
    throw new RangeError(`the skin table holds ${file.length} bytes, not ${SKIN_TABLE_FILE_BYTES}`)
  const words = new Uint32Array(SKIN_TABLE_TEXELS)
  for (let texel = 0; texel < SKIN_TABLE_TEXELS; texel++)
    words[texel] = file[3 * texel] | (file[3 * texel + 1] << 8) | (file[3 * texel + 2] << 16)
  return words
}
