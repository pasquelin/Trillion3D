/**
 * THE CAPSULE SHADOW PASS'S LAYOUT: the words of its uniform, the bindings of its programs and the sizes
 * its textures and buffers take, in one place for the CPU that writes them (`plan.ts`) and the shaders that read them.
 */

/** Threads of a side of a tile; a tile is a workgroup of `CAPSULE_TILE` by `CAPSULE_TILE` pixels of the shadow factors' texture. */
export const CAPSULE_TILE = 8

/** The shapes a tile keeps for each of its two depth groups; more are dropped. */
export const CAPSULE_TILE_SHAPES = 512

/** The depth, in metres, from which a pixel is taken for the sky and gets no shadow, and bounds no tile. */
export const CAPSULE_SKY_DEPTH = 200

/** The uniform of a pass, in floats: a `vec4f` at each of these (`CAPSULE_PARAMS`), after the two matrices. */
export const CAPSULE_PARAM_FLOATS = 68
export const CAPSULE_PARAM_BYTES = CAPSULE_PARAM_FLOATS * 4

/** Where each word of the uniform lies, in floats (`plan.ts`'s `writeCapsuleParams` writes them, the shader's `CapsuleParams` reads them in this order). */
export const CAPSULE_PARAMS = {
  /** The matrix that takes a clip position to the view's, and the one that takes the view's to the translated world's. */
  clipToView: 0,
  viewToTranslatedWorld: 16,
  /** Punctual lights: the light's translated position and the inverse of its radius. */
  lightPosition: 32,
  /** Punctual lights: the unit direction toward a directional light, and the angle of the light's cone, in radians. */
  lightAim: 36,
  /** The view's rectangle in the image: its first pixel and its size. */
  viewport: 40,
  /** The pass's rectangle: its first pixel and its size. */
  scissor: 44,
  /** The light's source radius, the reach of the shadow, the downsample factor and the number of shapes. */
  shape: 48,
  /** The cosine where the indirect shadow starts to fade and the slope of its fade, then the number of distance-field casters. */
  fade: 52,
  /** The tiles across and down, the intensity of the shadow on the caster's own surface, and 1 for a perspective view (0 orthographic). */
  extra: 56,
  /** How a device depth turns into a distance: for a perspective view the near plane in x and 1 in z, for an orthographic one the far less the near in x, the near in y and 0 in z. */
  depth: 60,
  /** The view's translation (the world's to the translated world's), in metres. */
  translation: 64,
} as const

/** The bind group of a shadow pass (group 0; the distance fields' scene, when casters are traced, is group 1 from binding 0). */
export const CAPSULE_BINDINGS = {
  params: 0,
  shapes: 1,
  lightData: 2,
  tileCounts: 3,
  factors: 4,
  receiverBentNormal: 5,
  bentNormal: 6,
  casterIndices: 7,
  /** The depth (`hizDepthWgsl`, its level 0 and its levels uniform at the first and the third) and the surfaces' flags. */
  depth: 8,
  flags: 11,
} as const

/** The distance-field casters a tile keeps for each of its two depth groups; more are dropped. */
export const CAPSULE_TILE_CASTERS = 64

/** The format of the shadow factors: the shadow in red, the depth it was worked out at in green (the reference writes two halves; WebGPU
 *  has no storage texture of them, and two floats keep the depth the upsample weighs by exactly). */
export const CAPSULE_FACTORS_FORMAT = 'rg32float' as const
/** The format of the bent normal the movable sky light's pass reads and writes. */
export const CAPSULE_BENT_NORMAL_FORMAT = 'rgba16float' as const

/** The uniform of the upsample draw, in floats, and where each vec4f of it lies. */
export const UPSAMPLE_PARAM_FLOATS = 28
export const UPSAMPLE_PARAM_BYTES = UPSAMPLE_PARAM_FLOATS * 4
export const UPSAMPLE_PARAMS = {
  /** The pass's rectangle in the image: first pixel and size. */
  scissor: 0,
  /** The image's size in pixels, and its inverse. */
  buffer: 4,
  /** The factors texture's size and the last texel the pass wrote, in x and y. */
  low: 8,
  /** The tiles across and down, a tile's side in image pixels, and 1 where the output is a light attenuation (square-rooted, to keep bits for the darks). */
  tile: 12,
  /** The view's rectangle in the image: first pixel and size. */
  viewport: 16,
  /** The intensity of the shadow on a caster's own surface, the downsample factor and, composed into a sun's mask, the layer. */
  shading: 20,
  /** How a device depth turns into a distance (`CAPSULE_PARAMS.depth`). */
  depth: 24,
} as const

/** The upsample draw's bindings. */
export const UPSAMPLE_BINDINGS = {
  params: 0,
  tileCounts: 1,
  factors: 2,
  sunMask: 3,
  depth: CAPSULE_BINDINGS.depth,
  flags: CAPSULE_BINDINGS.flags,
} as const

/** The light direction pass's uniform, in words: the number of records and the sky light's mode (two words of a vec4u); the cone angle, the sky angle's
 *  scale and the least sky angle (three floats of a vec4f). */
export const LIGHT_DIRECTION_PARAM_FLOATS = 8
export const LIGHT_DIRECTION_PARAMS = { counts: 0, angles: 4 } as const
/** The light direction pass's bindings in group 0; the volumetric lightmap's are group 1 from binding 0, the sky light's harmonics and uniform group 2. */
export const LIGHT_DIRECTION_BINDINGS = { params: 0, input: 1, output: 2 } as const
/** Where the pass reads the sky light's diffuse light (`skyLightDiffuseWgsl`). */
export const LIGHT_DIRECTION_SKY = { group: 2, harmonics: 0, params: 1 } as const
/** The workgroup size of the light direction pass. */
export const LIGHT_DIRECTION_GROUP = 64
