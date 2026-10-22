import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { LIGHT_FUNCTION_SHIFT, LIGHT_KIND } from '../../../../sdk-core/src/scene/light/contracts.ts'

/**
 * THE LIGHT FUNCTION ATLAS TEXTURE, the one place its layout is written (`entries.ts` and `atlas.ts`
 * write it, `readWgsl.ts` reads it). One texture of 32-bit words, four to a texel (`rgba32uint`, the
 * bits of floats): `side` texels across and `side` plus the table's rows down.
 * - The first `side` rows are the slots, `edge` by `edge` squares of `slot` texels: the square root
 *   of the colour (`lightFunctionRenderWgsl`), in the first channel or the three first.
 * - The rows below are the table: entry `index` of it, in the order the lights wear their light
 *   function, is `ENTRY_VEC4S` texels from texel `index * ENTRY_VEC4S` of the table, the table's
 *   texels laid row after row, `side` to a row. Entry 0 is no light function.
 * So the atlas and its table are one binding, and none of the stage's storage buffers.
 *
 * An entry is five `vec4f`, the reference's: the head, then the four rows of the matrix that takes
 * a world point to the light's own axes (the point as a row vector times the matrix).
 * - head: the fade distance in metres; the light's kind rank (`LIGHT_KIND`) in the low byte of the
 *   second word, the disabled brightness as a half float above it; the slot's corner in the atlas
 *   (u then v, 16 bits each) in the third; the tangent of the cone the function is projected through,
 *   negative for none.
 * - entry 0 holds, in its second `vec4f`, what the atlas gives every entry: the slot's texel size
 *   in atlas coordinates, the atlas's side in texels, the slot's, and 1 where the volumetric fog's
 *   local lights read the light functions (its sun's always do: `lightFunctionFogOf`).
 */
export const ENTRY_VEC4S = 5
/** Entries the table is allocated in multiples of: the texture is made again only when it grows. */
export const ENTRY_STEP = 32
/** The `vec4f` of entry 0 that holds the atlas's numbers. */
export const ATLAS_NUMBERS_AT = 1
/** The kind ranks the shader tests, by name. */
export const KINDS = LIGHT_KIND
/** The texture's format: four words a texel, read as floats by their bits. */
export const ATLAS_TEXTURE_FORMAT: GPUTextureFormat = 'rgba32uint'
/** The rows a table of `entries` entries takes in an atlas `side` texels across. */
export const tableRows = (entries: number, side: number) => ceilDiv(entries * ENTRY_VEC4S, side)
export { LIGHT_FUNCTION_SHIFT }
