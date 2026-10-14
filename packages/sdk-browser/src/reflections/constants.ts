import { DEG2RAD } from '../../../math/src/constants.ts'

/**
 * The constants of the reflection's shaders, by the name they read, one table: the WGSL block is
 * printed from it (`REFLECTION_CONSTANTS_WGSL`, each the `f32` nearest its value) and the tests
 * that state a rule in their terms read it here.
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
   *  (`fsFront`, `../webgpu/blend/frontStageWgsl.ts`): one that hides more than half of what lies behind it. A fainter one
   *  tints its backdrop and is no wall to a ray. */
  REFLECTION_FRONT_COVERAGE: 0.5,
  /** The bound of the half-vector's angle (`REFLECTION_CONE_WGSL`): tan 40°. */
  REFLECTION_CONE_LIMIT: Math.tan(40 * DEG2RAD),
  /** The distance past which a ray is taken as infinite: 2²³ world units, where a float32 no
   *  longer holds a unit step. */
  REFLECTION_FAR: 2 ** 23,
  /** The same-surface test's normals (`reflectionSameSurface`): a texel weighs (N·Nₜ)^this, 0.79 at
   *  10° apart, a tenth at 30°, nothing across a crease. */
  REFLECTION_NORMAL_POWER: 16,
  /** The least N·V the same-surface test (`reflectionSameSurface`) divides by: a surface seen this
   *  close to edge-on spans ⌈1/8⌉ = eight pixels' depth across a pixel, a steeper one no more. */
  REFLECTION_GRAZING: 1 / 8,
  /** The temporal clamp's width (`temporalWgsl.ts`), in standard deviations of the fresh texels around
   *  a texel: a history further from their mean than this is pulled back to it. */
  REFLECTION_CLAMP: 1.25,
  /** The share of a sampled lobe's width its ray keeps as its own cone (`sampleWgsl.ts`): the rest,
   *  √(1 − ¼) of it, is spread by the sampled direction; widths add in quadrature, so the sampled
   *  rays' average reads the whole lobe. */
  REFLECTION_SAMPLE_CONE: 1 / 2,
} as const

/**
 * The integer constants of the reflection's shaders, one table, printed as `u32` (`REFLECTION_COUNTS_WGSL`).
 */
export const REFLECTION_COUNTS = {
  /** The images a texel's history averages at most (`temporalWgsl.ts`): three turns of the 2×2 block's
   *  four picks, and the count a still view's history freezes at. Four bits of the history's word. */
  REFLECTION_HISTORY: 12,
  /** The widest spatial reuse, in half texels (`spatialWgsl.ts`): two bits of the fresh texel's word. */
  REFLECTION_REUSE_RADIUS: 3,
  /** The neighbours the spatial reuse reads at most (`spatialWgsl.ts`), on a disc of its radius. */
  REFLECTION_REUSE_TAPS: 8,
  /** The period of the per-image sample sequence (`sampleWgsl.ts`): its index stays exact in an `f32`. */
  REFLECTION_SEQUENCE: 4096,
} as const

/** The format of the reflection target: the lit image's precision. */
export const REFLECTION_FORMAT: GPUTextureFormat = 'rgba16float'
/** Threads per side of a reflection workgroup: one pixel or one texel each. */
export const REFLECTION_SIDE = 8
