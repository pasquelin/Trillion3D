/**
 * THE REFLECTION CAPTURES' LAYOUT, pure data read from Node as well: how many captures the light holds, the words of a capture's
 * record and the formats of the cube array.
 */

/** The most captures the lighting holds at once: the uniform block of the reference's (`341` records fill 43 KB, under the 64 KB a
 *  uniform binding takes). */
export const MAX_REFLECTION_CAPTURES = 341

/** The words of a capture's record: eight vectors of four. */
export const CAPTURE_RECORD_WORDS = 32

/** The words of the block's header: the number of captures, the cube's last mip, whether the diffuse light is read, and a spare. */
export const CAPTURE_HEADER_WORDS = 4

/** The words of the whole block. */
export const CAPTURE_BLOCK_WORDS =
  CAPTURE_HEADER_WORDS + MAX_REFLECTION_CAPTURES * CAPTURE_RECORD_WORDS

/** The shapes' codes in a record's properties. */
export const CAPTURE_SHAPE_CODE = { sphere: 0, box: 1 } as const

/** The mips of a cube of side `side`: down to one texel. */
export const captureMipCount = (side: number) => Math.log2(side) + 1

/** The mip the diffuse light is kept in, counted from the last: the cube of 8 texels (the reference's `ReflectionCubemapMaxMip - 3`). */
export const CAPTURE_DIFFUSE_MIPS_FROM_LAST = 3

/** The mips from the last, at 1, 2, 4 and 8 texels, the diffuse light fills (the reference's four result mips). */
export const CAPTURE_DIFFUSE_RESULT_MIPS = 4

/** The mip of the cube the diffuse light is convolved from (the reference's `GDiffuseIrradianceReferenceMip`): the cube of 8 texels. */
export const CAPTURE_DIFFUSE_REFERENCE_MIP = 3

/** The distance, metres, the diffuse light's capture distance is adjusted along the normal by: the reference's 50 centimetres. */
export const CAPTURE_NORMAL_ADJUST = 0.5

/** The least distance, metres, the diffuse light's box lookup reads along the normal: the reference's 1000 centimetres. */
export const CAPTURE_DIFFUSE_LEAST_REACH = 10
