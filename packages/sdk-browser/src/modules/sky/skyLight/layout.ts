import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'

/**
 * THE SKY LIGHT'S CAPTURE, ITS SIZES AND ITS FACES: the cube the sky is captured into, the
 * formats and usages of its textures, the sizes the programs are dispatched over. Pure data, read
 * from Node as well.
 *
 * The cube holds the sky in a frame whose third axis is up, as a cube's faces are laid
 * (`cubeToScene`, `cubeWgsl.ts`, turns it into the scene's, whose up is its second): face `f` of
 * the six, in the order +x, -x, +y, -y, +z, -z of a cube texture, looks along `FACES[f].forward`
 * with `right` across its pixels and `up` over them (the frame's own axes). A pixel's direction is
 * `forward + ndc.x * right + ndc.y * up`, the field of view 90 degrees.
 */

/** The cube's faces. */
export const CUBE_FACES = 6

/** The format of the captured and the filtered cubes: four half floats, which a storage texture
 *  takes (the 11-11-10 float format is none) and which holds the range the capture clamps to. */
export const SKY_LIGHT_CUBE_FORMAT: GPUTextureFormat = 'rgba16float'

/** The most radiance the capture writes: the largest value of the 10-bit float, which the radiance
 *  of a real-time capture is held under. */
export const CAPTURE_MAX_RADIANCE = 64512

/** `GPUTextureUsage`'s flags, written in the clear: this table is also read from Node. */
const TEXTURE_BINDING = 4,
  STORAGE_BINDING = 8,
  RENDER_ATTACHMENT = 16
/** The cubes the filtered texture holds: the two the real-time capture takes turns in, or a
 *  specified cubemap's source and, after it, the blend's destination. */
export const FILTERED_CUBES = 2

/** The captured cube is drawn into, filtered from and written by the mip chain; the filtered cubes
 *  are written by compute and sampled. */
export const CAPTURED_CUBE_USAGE = TEXTURE_BINDING | STORAGE_BINDING | RENDER_ATTACHMENT
export const FILTERED_CUBE_USAGE = TEXTURE_BINDING | STORAGE_BINDING
/** The clouds of a face are traced into a storage texture and sampled by the composition. */
export const CLOUD_FACE_USAGE = TEXTURE_BINDING | STORAGE_BINDING

/** The states of the sliced capture (`schedule.ts`). */
export const TIME_SLICE_COUNT = 12
/** `vec4`s of the harmonics' buffer: seven of the light's, one of the mean irradiance. */
export const IRRADIANCE_VECTORS = 8
/** The harmonics' buffer holds a set for each filtered cube (the cubes the real-time capture takes turns
 *  in, or a specified cubemap and the cube it blends to), each at a multiple of the 256 bytes a storage
 *  binding's offset is a multiple of: `HARMONICS_SET_VECTORS` vec4s apart. */
export const HARMONICS_SETS = 2
export const HARMONICS_SET_BYTES = 256
export const HARMONICS_SET_VECTORS = HARMONICS_SET_BYTES / 16
/** The threads of the harmonics' group along each side; one group, one thread to a direction. */
export const IRRADIANCE_SIDE = 8
/** The harmonics are summed from the mip of this side: a 16 texel face. */
export const IRRADIANCE_SOURCE_SIDE = 16
/** The threads of a filtering group along each side. */
export const FILTER_GROUP_SIDE = 8

/** The roughness law of the mips (`mipRoughness`, `cubeWgsl.ts`): the roughest mip is
 *  `ROUGHEST_LEVEL` levels from the last, and the exponent of the roughness changes by
 *  `1 / MIP_ROUGHNESS_SLOPE` a level. */
export const ROUGHEST_LEVEL = 1
export const MIP_ROUGHNESS_SLOPE = 1.2

/** Bytes between the blocks of one uniform buffer read at a dynamic offset. */
export const BLOCK_STRIDE = 256

/** The mip the harmonics are summed from: the one of side 16. The reference computes it as an
 *  unsigned number, so a cube under 16 wraps past every level, which a read clamps to the last. */
export const irradianceMip = (width: number) =>
  (Math.log2(width) - Math.log2(IRRADIANCE_SOURCE_SIDE)) >>> 0

/** Groups of `size` threads over `n` texels. */
export const groupsOver = (n: number, size = FILTER_GROUP_SIDE) => ceilDiv(n, size)

/** The faces' axes in the cube's frame (third axis up). */
export const FACES = [
  { forward: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { forward: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { forward: [0, 1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { forward: [0, -1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  { forward: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { forward: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
] as const satisfies readonly {
  forward: readonly number[]
  right: readonly number[]
  up: readonly number[]
}[]

/** A vector of the cube's frame in the scene's: the cube's third axis is the scene's up (second),
 *  the cube's second is the scene's third reversed — a turn about the first axis. */
export const cubeToScene = (v: readonly number[]) => [v[0], v[2], -v[1]] as const
