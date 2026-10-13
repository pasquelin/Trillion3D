/**
 * The host's own surface constants, each named for what it means.
 *
 * A host material declares its raster state as numbers, and the engine compares against them at
 * the boundary that reads a surface (`surfaceImport.ts`); a texture is the engine's own record and
 * declares its state in the engine's words (`../../../sdk-core/src/texture/contract.ts`). Naming the rendering
 * library to get those numbers would put the library back on the engine path for a comparison
 * that is not a computation, so they are named here instead — the same move
 * `../scene/materialSide.ts` already makes for the three face constants.
 *
 * WHAT EACH NUMBER STANDS FOR. `HOST_BLENDING_NORMAL` is source-over, the only blend equation glTF's
 * `BLEND` alpha mode defines; the other modes are the world API's. `HOST_NORMAL_MAP_TANGENT_SPACE` is glTF's normal texture, whose
 * vectors are expressed in the surface's tangent frame.
 *
 * The witness (`bench/witnesses/three/parity/browser/host/surfaceConstants.test.ts`) holds them
 * to the witness library's own constants, value by value: a witness may name the library, the
 * engine path may not.
 */

/** Blend modes, in the host's order: none, source-over — the blend equation of glTF's `BLEND`
 *  alpha mode —, additive, subtractive, multiply (`../scene/materialBlending.ts`). */
export const HOST_BLENDING_NONE = 0,
  HOST_BLENDING_NORMAL = 1,
  HOST_BLENDING_ADDITIVE = 2,
  HOST_BLENDING_SUBTRACTIVE = 3,
  HOST_BLENDING_MULTIPLY = 4

/** A normal texture whose vectors live in the surface's tangent frame, as glTF defines it. */
export const HOST_NORMAL_MAP_TANGENT_SPACE = 0

/** The depth test passes at equal or nearer depth: every surface's until it says otherwise. */
export const HOST_DEPTH_LESS_EQUAL = 3
