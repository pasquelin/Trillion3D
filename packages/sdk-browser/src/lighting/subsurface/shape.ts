import { PROFILE_COLUMNS } from '../../../../sdk-core/src/lighting/subsurfaceProfile/table.ts'
import { SUBSURFACE_RADIUS_SCALE } from '../../../../sdk-core/src/contracts/subsurfaceScatteringOptions.ts'

/** The radius of the separable passes' offsets, as the shaders write it. */
export const SSS_RADIUS_SCALE_WORD = `${SUBSURFACE_RADIUS_SCALE}.0`

/**
 * WHAT DECIDES THE PROGRAMS OF THE SUBSURFACE PASS (`sssShapeHeader`), each a constant of the module so that what it rules out is
 * not compiled: whether it scatters at half the image's size (`half`), whether every profile is scattered by the separable passes
 * (`forceSeparable`), whether the profile of each texel is read from a texture of its own (`cache`), the separable passes' sample set (0
 * to 2), whether the sampled scattering weighs a sample by the normal as well as the depth (`bilateral`), the quality of the
 * reconstruction of the light (`high`), the checkerboard (`checker`) and the filter of the scattering's reads (`filter`).
 */
export interface SubsurfaceShape {
  readonly half: boolean
  readonly forceSeparable: boolean
  readonly cache: boolean
  readonly sampleSet: number
  readonly bilateral: boolean
  readonly high: boolean
  readonly checker: boolean
  readonly filter: boolean
}

/** The kernel of a sample set: the count of its samples (the central one included) and the profile table's column it starts at. */
const KERNELS = [
  { count: PROFILE_COLUMNS.kernel2Size, offset: PROFILE_COLUMNS.kernel2 },
  { count: PROFILE_COLUMNS.kernel1Size, offset: PROFILE_COLUMNS.kernel1 },
  { count: PROFILE_COLUMNS.kernel0Size, offset: PROFILE_COLUMNS.kernel0 },
] as const

/** Two shapes the same are one key. */
export const subsurfaceShapeKey = (s: SubsurfaceShape) =>
  [s.half, s.forceSeparable, s.cache, s.sampleSet, s.bilateral, s.high, s.checker, s.filter]
    .map(Number)
    .join('')

/** The constants of the module for `shape`. */
export const sssShapeHeader = (s: SubsurfaceShape) => {
  const kernel = KERNELS[s.sampleSet]
  return `const SSS_HALF:bool=${s.half};
const SSS_FORCE_SEPARABLE:bool=${s.forceSeparable};
const SSS_CACHE:bool=${s.cache};
const SSS_BILATERAL:bool=${s.bilateral};
const SSS_HIGH:bool=${s.high};
const SSS_CHECKER:bool=${s.checker};
const SSS_FILTER:bool=${s.filter};
const SSS_KERNEL_COUNT:u32=${kernel.count}u;
const SSS_KERNEL_OFFSET:u32=${kernel.offset}u;`
}
