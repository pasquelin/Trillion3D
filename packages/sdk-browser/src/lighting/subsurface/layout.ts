import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * THE SCREEN-SPACE SUBSURFACE PASS'S LAYOUTS: the tiles it works in, the five lists of them, the uniform every kernel reads and the
 * bindings of the groups.
 *
 * The image is cut in tiles of 8 × 8 texels of the scattering's resolution. The tiles that hold a subsurface-profile pixel are listed
 * (`SSS_TILE_TYPE.all`), those of them whose pixels all scatter inside their own footprint apart (`passthrough`) and the others
 * (`nonPassthrough`); the setup then splits the others by how their pixels scatter, the sampled way (`sampled`) or the separable one
 * (`separable`). A list holds a tile as its two coordinates, twelve bits each.
 */
export const SSS_TILE = 8
export const SSS_TILE_TYPE = {
  sampled: 0,
  separable: 1,
  passthrough: 2,
  nonPassthrough: 3,
  all: 4,
} as const
export const SSS_TILE_TYPES = 5
/** The mip chain of the setup texture when sampled scattering runs at the image's size: at most six levels. */
export const SSS_MAX_MIPS = 6
/** The largest count of groups a dispatch holds on one axis: a list longer wraps onto the second. */
export const SSS_DISPATCH_WRAP = 65535
/** The most mips a chain makes beyond the first. */
const SSS_MIP_DISPATCHES = SSS_MAX_MIPS - 1

/** The entries of the dispatch arguments, three words each: the tile lists' by type, then the clears of the two scattering targets
 *  (made only when a tile reads them) and the mip chain's levels. */
export const SSS_ARGS = {
  clearPassTwo: SSS_TILE_TYPES,
  clearPassOne: SSS_TILE_TYPES + 1,
  mip: SSS_TILE_TYPES + 2,
  entries: SSS_TILE_TYPES + 2 + SSS_MIP_DISPATCHES,
} as const

/** The uniform every kernel reads (`writeSubsurfaceParams`), `vec4`s named `view` in the shaders (`DEPTH_WGSL` reads `depth` and
 *  `radius`). */
export const SSS_PARAMS = fieldLayout('SssParams', [
  // The drawn view's size in pixels, then the size of the textures of the image's resolution.
  ['scene', 'vec4f'],
  // The same of the scattering's resolution.
  ['sub', 'vec4f'],
  // The scatter radius' scale over the projection and the kernel (x), the scale and the depth (y), the override of the sampled
  // scattering's count (z), the count of tiles from which the mip chain is made (w).
  ['scatter', 'vec4f'],
  // The share of the scattering inside the pixel's own footprint above which a tile is not scattered (x).
  ['tune', 'vec4f'],
  // The image's number, its number modulo 8, the checkerboard's phase and the count of tiles of the image.
  ['words', 'vec4u'],
  // The count of tiles on x and y, the mips of the setup texture, whether a neighbour that is not a profile pixel adds nothing
  // to the checkerboard's reconstruction.
  ['tiles', 'vec4u'],
  // The projection's jitter in clip units, whether the velocity stage measured this image, whether the quality history is read.
  ['jitter', 'vec4f'],
  // Where this image's clip positions fell in the last image's.
  ['clip', 'mat4x4f'],
  ['depth', 'vec4f'],
  ['radius', 'vec4f'],
] as const)
export const SSS_PARAMS_BYTES = SSS_PARAMS.words * 4

/** The bindings of group 0, every kernel's: the uniform, the depth pyramid (three bindings), the surfaces' normals, base colours and
 *  flags, the data a profile pixel keeps, the profile table, the vectors of motion and the linear sampler. */
export const SSS_BINDINGS = {
  params: 0,
  depth: 1,
  normals: 4,
  base: 5,
  flags: 6,
  data: 7,
  profiles: 8,
  vectors: 9,
  sampler: 10,
} as const

/** The bindings of group 1 of the kernels: three textures read by sampling, the ids read by load, and the three storage textures
 *  a kernel writes. Of the raster passes: the lit image and the scattered image. */
export const SSS_TEXTURES = { a: 0, b: 1, c: 2, ids: 3, out: 4, history: 5, idsOut: 6 } as const
/** The bindings of group 2: the counts of each list, the lists and the masks the classification marks. */
export const SSS_TILES = { counts: 0, lists: 1, masks: 2 } as const
/** The bindings of group 3 of the kernels that build the arguments: the dispatches' and the draws'. */
export const SSS_ARGUMENTS = { dispatch: 0, draw: 1 } as const

/** The format of the textures of the passes: the scattering's, and the profile table's. */
export const SSS_COLOUR_FORMAT: GPUTextureFormat = 'rgba16float'
/** The profile id of each texel: one byte where the device stores to eight-bit integers, else a word. */
export const SSS_IDS_FORMAT = (tier1: boolean): GPUTextureFormat => (tier1 ? 'r8uint' : 'r32uint')
