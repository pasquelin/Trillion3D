import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { DEG2RAD } from '../../../math/src/constants.ts'

/** The image border, a fraction of its height, over which a hit fades into the next stage. */
const REFLECTION_EDGE = 1 / 16
/** The taps of a footprint along its long axis at most: past that ratio of its axes, the level is
 *  the long axis's share of a tap. */
const REFLECTION_TAPS = 5
/** The screen distance, in pixels (the L1 length of the ray on the image), a ray is marched over at
 *  most: its iterations are bounded by it (`reflectionBudget`), and the screen's confidence fades
 *  over its second half, so that the next stage carries what lies farther. */
const REFLECTION_STEP_CAP = 256
/** The thickness of a surface the march assumes, in pixels of its footprint: a ray behind a pixel's
 *  surface by more passes behind it and goes on (a pole, a fence), by less is inside it and hits.
 *  The same thickness at every depth and under every projection (`reflectionBack`). */
const REFLECTION_THICKNESS = 4
/** The coverage from which a blended fragment is a surface of the depth a ray meets
 *  (`reflectionFrontAdd`): one that hides more than half of what lies behind it. A fainter one
 *  tints its backdrop and is no wall to a ray. */
const REFLECTION_FRONT_COVERAGE = 0.5
/** The weight under which a stage of the chain is not evaluated: 2⁻¹¹, under half a step of an
 *  8-bit channel of a radiance of one. */
const REFLECTION_EPSILON = 2 ** -11

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
  `const REFLECTION_EDGE:f32=${wgslF32(REFLECTION_EDGE)};
const REFLECTION_TAPS:f32=${wgslF32(REFLECTION_TAPS)};
const REFLECTION_STEP_CAP:f32=${wgslF32(REFLECTION_STEP_CAP)};
const REFLECTION_THICKNESS:f32=${wgslF32(REFLECTION_THICKNESS)};
const REFLECTION_EPSILON:f32=${wgslF32(REFLECTION_EPSILON)};
const REFLECTION_FRONT_COVERAGE:f32=${wgslF32(REFLECTION_FRONT_COVERAGE)};
const REFLECTION_HALF_MAXIMUM:f32=${wgslF32(Math.SQRT2)};
const REFLECTION_CONE_LIMIT:f32=${wgslF32(Math.tan(40 * DEG2RAD))};
const REFLECTION_NUDGE:f32=${wgslF32(2 ** -8)};
const REFLECTION_FAR:f32=${wgslF32(2 ** 23)};`,
)

/** The format of the reflection target and of the radiance pyramid: the lit image's. */
export const REFLECTION_FORMAT: GPUTextureFormat = 'rgba16float'
/** Threads per side of a reflection workgroup: one pixel or one texel each. */
export const REFLECTION_SIDE = 8
