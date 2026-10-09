import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { DEG2RAD } from '../../../math/src/constants.ts'

/** Iterations a level of the depth pyramid pays the march: a ray crosses at most two cells of each
 *  level climbing and two descending, and each refused ascent is one more — eight a level, `levels
 *  × 8` in all. A ray that skims a surface the pyramid's bounds cannot clear (they hold the
 *  farthest height of a cell, not its tilt) needs more: it is a miss. */
const REFLECTION_ITERATIONS_PER_LEVEL = 8
/** The image border, a fraction of its height, over which a hit fades into the environment. */
const REFLECTION_EDGE = 1 / 16
/** The taps of a footprint along its long axis at most: past that ratio of its axes, the level is
 *  the long axis's share of a tap. */
const REFLECTION_TAPS = 5

/**
 * The constants of the reflection's shaders. `REFLECTION_NUDGE` takes a ray past a cell boundary: four
 * units in the last place of a pixel coordinate on the largest image WebGPU guarantees (8192
 * pixels, whose float32 step is 2⁻¹⁰), so that no rounding leaves it behind. `REFLECTION_FAR` is the
 * distance past which a ray is taken as infinite: 2²³ world units, where a float32 no longer holds
 * a unit step. `REFLECTION_CONE_LIMIT` is the bound of the half-vector's angle (`REFLECTION_CONE_WGSL`).
 */
export const REFLECTION_CONSTANTS_WGSL = wgslBlock(
  'REFLECTION_CONSTANTS_WGSL',
  [],
  `const REFLECTION_ITERATIONS_PER_LEVEL:u32=${REFLECTION_ITERATIONS_PER_LEVEL}u;
const REFLECTION_EDGE:f32=${wgslF32(REFLECTION_EDGE)};
const REFLECTION_TAPS:f32=${wgslF32(REFLECTION_TAPS)};
const REFLECTION_HALF_MAXIMUM:f32=${wgslF32(Math.SQRT2)};
const REFLECTION_CONE_LIMIT:f32=${wgslF32(Math.tan(40 * DEG2RAD))};
const REFLECTION_NUDGE:f32=${wgslF32(2 ** -8)};
const REFLECTION_FAR:f32=${wgslF32(2 ** 23)};`,
)

/** The format of the reflection target and of the radiance pyramid: the lit image's. */
export const REFLECTION_FORMAT: GPUTextureFormat = 'rgba16float'
/** Threads per side of a reflection workgroup: one pixel or one texel each. */
export const REFLECTION_SIDE = 8
