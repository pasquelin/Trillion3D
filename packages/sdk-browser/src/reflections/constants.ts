import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { DEG2RAD } from '../../../math/src/constants.ts'

/**
 * THE CONSTANTS OF THE REFLECTION'S SHADERS, one table the WGSL block is printed from
 * (`REFLECTION_CONSTANTS_WGSL`, each as the `f32` nearest it) and the tests read.
 */
export const REFLECTION_CONSTANTS = {
  /** The image border, a fraction of its height, over which a hit fades into the next stage. */
  REFLECTION_EDGE: 1 / 16,
  /** The taps of a footprint along its long axis at most: past that ratio of its axes, the level
   *  is the long axis's share of a tap. */
  REFLECTION_TAPS: 5,
  /** The screen distance, in pixels (the L1 length of the ray on the image), a ray is marched over
   *  at most: its iterations are bounded by it (`screenMarchBudget`), and the screen's confidence
   *  fades over its second half, so that the next stage carries what lies farther. */
  REFLECTION_STEP_CAP: 256,
  /** The thickness of a surface the march assumes, in pixels of its footprint: a ray behind a
   *  pixel's surface by more passes behind it and goes on (a pole, a fence), by less is inside it
   *  and hits. The same thickness at every depth and under every projection (`screenBack`). */
  REFLECTION_THICKNESS: 4,
  /** The weight under which a stage of the chain is not evaluated: 2⁻¹¹, under half a step of an
   *  8-bit channel of a radiance of one. */
  REFLECTION_EPSILON: 2 ** -11,
  /** The coverage from which a blended fragment is a surface of the depth a ray meets
   *  (`reflectionFrontOut`): one that hides more than half of what lies behind it. A fainter one
   *  tints its backdrop and is no wall to a ray. */
  REFLECTION_FRONT_COVERAGE: 0.5,
  /** The bound of the half-vector's angle (`REFLECTION_CONE_WGSL`): tan 40°. */
  REFLECTION_CONE_LIMIT: Math.tan(40 * DEG2RAD),
  /** The distance past which a ray is taken as infinite: 2²³ world units, where a float32 no
   *  longer holds a unit step. */
  REFLECTION_FAR: 2 ** 23,
} as const

/** The reflection's constants as the shaders read them (`REFLECTION_CONSTANTS`). */
export const REFLECTION_CONSTANTS_WGSL = wgslBlock(
  'REFLECTION_CONSTANTS_WGSL',
  [],
  Object.entries(REFLECTION_CONSTANTS)
    .map(([name, value]) => `const ${name}:f32=${wgslF32(value)};`)
    .join('\n'),
)

/** The format of the reflection target and of the radiance pyramid: the lit image's. */
export const REFLECTION_FORMAT: GPUTextureFormat = 'rgba16float'
/** Threads per side of a reflection workgroup: one pixel or one texel each. */
export const REFLECTION_SIDE = 8
