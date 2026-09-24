/**
 * The host's own surface constants, each named for what it means.
 *
 * A host material and a host texture declare their state as numbers, and the engine compares
 * against them at the two boundaries that read a surface (`surfaceImport.ts`,
 * `surfaceGate.ts`). Naming the rendering library to get those numbers would put the library
 * back on the engine path for a comparison that is not a computation, so they are named here
 * instead — the same move `../scene/materialSide.ts` already makes for the three face constants.
 *
 * WHAT EACH NUMBER STANDS FOR. Addressing and filtering are the glTF `sampler` states: the three
 * wrap modes in the order glTF lists them — repeat, clamp to edge, mirrored repeat — then the six
 * sampling modes in the order the mip chain adds to them: nearest, its two mip combinations,
 * linear, then its two. The host numbers that whole set as one dense run, which is why a wrap
 * constant and a filter constant share it. `HOST_MAPPING_UV` is the one mapping a glTF texture
 * can declare: the sampler reads the UV set the material names, and nothing is derived from a
 * reflection vector. `HOST_BLENDING_NORMAL` is source-over, the only blend equation glTF's
 * `BLEND` alpha mode defines. `HOST_NORMAL_MAP_TANGENT_SPACE` is glTF's normal texture, whose
 * vectors are expressed in the surface's tangent frame.
 *
 * `surfaceConstants.test.ts` holds them to the host library's own constants, value by value:
 * a test may name the library, the engine path may not.
 */

/** Addressing modes of a sampler, glTF's `wrapS`/`wrapT`. */
export const HOST_WRAP_REPEAT = 1000,
  HOST_WRAP_CLAMP_TO_EDGE = 1001,
  HOST_WRAP_MIRRORED_REPEAT = 1002;

/** Sampling modes, glTF's `magFilter`/`minFilter`, the mip combinations included. */
export const HOST_FILTER_NEAREST = 1003,
  HOST_FILTER_NEAREST_MIP_NEAREST = 1004,
  HOST_FILTER_NEAREST_MIP_LINEAR = 1005,
  HOST_FILTER_LINEAR = 1006,
  HOST_FILTER_LINEAR_MIP_NEAREST = 1007,
  HOST_FILTER_LINEAR_MIP_LINEAR = 1008;

/** The texture is addressed by a UV set the material names, not by a derived vector. */
export const HOST_MAPPING_UV = 300;

/** Source-over: the blend equation of glTF's `BLEND` alpha mode. */
export const HOST_BLENDING_NORMAL = 1;

/** A normal texture whose vectors live in the surface's tangent frame, as glTF defines it. */
export const HOST_NORMAL_MAP_TANGENT_SPACE = 0;

/** The depth test passes at equal or nearer depth: every surface's until it says otherwise. */
export const HOST_DEPTH_LESS_EQUAL = 3;

/** Channels of a raw texture's texels: four, three, or red alone. */
export const HOST_FORMAT_RGBA = 1023,
  HOST_FORMAT_RGB = 1022,
  HOST_FORMAT_RED = 1028;

/** How a texture's numbers are read: sRGB-encoded colour, linear, or undeclared. */
export const HOST_COLOUR_SPACE_SRGB = 'srgb',
  HOST_COLOUR_SPACE_LINEAR = 'srgb-linear',
  HOST_COLOUR_SPACE_NONE = '';
