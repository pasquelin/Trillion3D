import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { HDR_FORMAT } from '../../../scene/targetFormats.ts'

/**
 * What the depth of field's passes agree on, with no shader text (the byte rules read it without the
 * renderer's, as `../motionBlur/motionBlurLayout.ts` is read): the sizes of its tiles and groups, the
 * formats of what it keeps, and the uniforms every pass reads.
 */

/** Texels of the gather's size a tile of circle-of-confusion ranges covers, across and down, and the
 *  workgroup of every pass: 8 × 8 threads. */
export const COC_TILE = 8
export const GROUP = 8
/** Tiles a dilation reads each way at most, and dilations of each kind at most. */
export const MAX_DILATE_RADIUS = 3
/** The smallest circle radius a sprite is scattered at, in gather texels. */
export const MIN_SCATTER_COC = 3
/** The largest radius, in gather texels, the recombine's slight out of focus covers. */
export const MAX_RECOMBINE_COC = 3
/** Sprite groups the scatter budget keeps in reserve (a group is 2 × 2 samples). */
export const SCATTER_GROUP_MARGIN = 21
/** The sprite groups an instance of the scatter's draw packs: 64 vertex invocations of 6 vertices. */
export const SCATTER_GROUPS_PER_INSTANCE = 10
/** Vertices a sprite group draws. */
export const SCATTER_GROUP_VERTICES = 6
/** The `vec4f` entries of a sprite group in a draw list: its centre, then for each of its 4 samples
 *  its colour and radius and the two of its vignette data. */
export const SCATTER_GROUP_STRIDE = 13
/** The words of a draw's indirect arguments: vertices, instances, first vertex, first instance. */
export const DRAW_ARGUMENT_WORDS = 4
/** Side of the bokeh tables, in texels. */
export const BOKEH_LUT_SIZE = 32

/** The colour of every image the passes keep: the chain's HDR format, filterable, with an alpha. */
export const COLOR_FORMAT: GPUTextureFormat = HDR_FORMAT
/** The circle of confusion and the layers' opacity: one value a texel, held in the red channel of a
 *  half-float texture — the one single-channel half format a storage texture holds, four channels. */
export const COC_FORMAT: GPUTextureFormat = 'rgba16float'
/** The tile ranges: a foreground and a background texel each. */
export const TILE_FORMAT: GPUTextureFormat = 'rgba16float'
/** The bokeh tables. */
export const LUT_FORMAT: GPUTextureFormat = 'rgba16float'

/** The uniform every pass reads (`view` in the shaders: the temporal passes' name for the projection's
 *  depth terms `depth` and `radius`, which `DEPTH_WGSL` reads). */
export const DOF_PARAMS = fieldLayout('DofParams', [
  // The image's size, and the size of the textures it lies in, the top-left.
  ['image', 'vec4u'],
  // The gather's size, and the size of the textures it is made at.
  ['gather', 'vec4u'],
  // The tile grid, and the size of the first mip level of the reduced setup.
  ['tiles', 'vec4u'],
  // The sprite groups the draw lists hold, the pairs of samples the recombine takes, the layers.
  ['counts', 'vec4u'],
  // The ratio of the depth's size to the image's, and the depth's last texel.
  ['depthMap', 'vec4f'],
  // The circle of confusion's radius at infinity, its foreground and background limits, the depth
  // blur's radius: shares of the image's width.
  ['coc', 'vec4f'],
  // The squeeze and its inverse, the depth blur's rate per metre, the focus distance.
  ['lens', 'vec4f'],
  // The gather's width, the tile buckets' bound and its inverse, the radius' error.
  ['basis', 'vec4f'],
  // The bokeh: blades, rotation, the factors to its corners and to its sides.
  ['bokeh', 'vec4f'],
  // The rounded blade's radius and its centre's offset.
  ['blade', 'vec4f'],
  // The scatter's least radius, the colour a neighbour is compared to, the distinction limit, the
  // image's exposure.
  ['scatter', 'vec4f'],
  // The recombine's history rejection boost, its least blur.
  ['recombine', 'vec4f'],
  // The Petzval swirl: strength, falloff, the box's width and height; its corner radius.
  ['petzval', 'vec4f'],
  ['petzvalMore', 'vec4f'],
  // The sensor's size, the aperture, the distance the lens focuses the image at.
  ['optics', 'vec4f'],
  // The barrel's radius and length, a length of -1 where there is no vignette.
  ['barrel', 'vec4f'],
  // The matte box's three flags: the sine and cosine of the pitch and of the roll, then the
  // reciprocal of the pitch's sine and the length.
  ['matteAngles', 'array<vec4f,3>'],
  ['matteSizes', 'array<vec4f,3>'],
  // The projection's depth terms and a pixel's radius (`post/taa/view.ts`).
  ['depth', 'vec4f'],
  ['radius', 'vec4f'],
] as const)
/** Bytes of the uniform. */
export const DOF_PARAMS_BYTES = DOF_PARAMS.words * 4

/** The uniform of one dispatch of a pass that repeats with another meaning (`DofStep`): a dilation's
 *  step, a reduction's input mip level and outputs. */
export const DOF_STEP = fieldLayout('DofStep', [
  ['a', 'vec4f'],
  ['b', 'vec4u'],
] as const)
/** Bytes of a step's uniform. */
export const DOF_STEP_BYTES = DOF_STEP.words * 4
