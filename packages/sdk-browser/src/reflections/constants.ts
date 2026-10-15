import { DEG2RAD } from '../../../math/src/constants.ts'
import { TAA_STILL_DRAWS } from '../taa/jitter.ts'

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
  /** The same-surface test's normals (`reflectionSameSurface`): two normals within this angle's cosine
   *  are one surface, whole. A normal map tilts a pixel's normal from its neighbours' by up to about
   *  20° on a bumpy road: a test that weighed it down (a power of N·Nₜ) let one texel of four answer
   *  the pixel, and showed the half grid's blocks. Cos 25°. */
  REFLECTION_CREASE_NEAR: Math.cos(25 * DEG2RAD),
  /** The same-surface test's crease: normals this far apart and more (cos 50°) are two surfaces — a
   *  modelled body's edge is 45° or more —, the weight falling smoothly from `REFLECTION_CREASE_NEAR`. */
  REFLECTION_CREASE_FAR: Math.cos(50 * DEG2RAD),
  /** The least N·V the same-surface test (`reflectionSameSurface`) divides by: a surface seen this
   *  close to edge-on spans ⌈1/8⌉ = eight pixels' depth across a pixel, a steeper one no more. */
  REFLECTION_GRAZING: 1 / 8,
  /** The temporal clamp's width (`temporalWgsl.ts`), in standard deviations of the fresh texels around
   *  a texel: a history further from their mean than this is pulled back to it. */
  REFLECTION_CLAMP: 1.25,
  /** How much farther a ray is shared on an image drawn while anything changes (`spatialWgsl.ts`):
   *  its history holds `REFLECTION_HISTORY` images, not `REFLECTION_STILL` — a sixth —, and sharing
   *  over twice the reach, four times the neighbours a disc holds, gives back most of that count; the
   *  reflection's edges soften by the lobe's own width, which a moving image shows for one image. */
  REFLECTION_SHORT_REACH: 2,
  /** Where along a proxy ray cut short for the field (`reach.ts`) its answer starts fading into the
   *  field's, a share of its reach (`proxy.ts`): over the last quarter a body met weighs less and less,
   *  the field the rest, so the reach's end — a curve on a floor, as the reach grows with the floor's
   *  distance — shows no seam between the two sources. */
  REFLECTION_REACH_FADE: 3 / 4,
  /** The floor of the reflections' normalised lengths (`ReflectionLobe.T`, a footprint's direction),
   *  of a sum of upsample weights and of a hit's slab: under it, the value is none. Under math's
   *  `DIVISOR_FLOOR` (1e-20) on purpose: these values can fall between the two — an axis a hair
   *  off the reflection, a neighbour's faint weight, a slab at a far depth —, where 1e-20 would
   *  shorten the normalised vector or scale the weighted mean down instead of normalising it. */
  REFLECTION_FLOOR: 1e-30,
} as const

/**
 * The integer constants of the reflection's shaders, one table, printed as `u32` (`REFLECTION_COUNTS_WGSL`).
 */
export const REFLECTION_COUNTS = {
  /** The images a texel's history averages at most while anything changes (`temporalWgsl.ts`): three
   *  turns of the 2×2 block's four picks, the window an exponential mean then keeps. */
  REFLECTION_HISTORY: 12,
  /** The images a still view's history averages, and the count it freezes at (`temporalWgsl.ts`): the
   *  temporal accumulation's own still average (`TAA_STILL_DRAWS`), sixteen turns of the block's
   *  picks — a glossy lobe read by one sample a texel an image needs that many, with its neighbours',
   *  for its mean to fall within a quarter of the lobe's radiance where a bright body fills a tenth of
   *  it. Six bits of the history's word (its count less one). */
  REFLECTION_STILL: TAA_STILL_DRAWS,
  /** The widest spatial reuse, in half texels (`spatialWgsl.ts`): two bits of the fresh texel's word. */
  REFLECTION_REUSE_RADIUS: 3,
  /** The neighbours the spatial reuse reads at most (`spatialWgsl.ts`), on a disc of its radius. */
  REFLECTION_REUSE_TAPS: 8,
  /** The iterations a reflection's screen march takes at most (`screenMarch`'s `cap`): the march's own
   *  bound grows with the screen distance, to 1091 at 1080p, while a mirror ray of floors and waves
   *  seen from 0.5° to 89° takes 16 on average and 35 at the 99th percentile (`budget.test.ts`). A ray
   *  that passes behind thin surfaces — poles, fences, a pane's edge — descends to the pixel and climbs
   *  again at each, a dozen iterations apiece: 48 cut such rays short (`thin.gpu.ts`, `glass.gpu.ts`),
   *  their screen answer handed to the next stage. 128, four times the 99th percentile, keeps them: the
   *  cap bounds the tail alone, a ray past it costing 128 iterations, an eighth of the bound at 1080p. */
  REFLECTION_MARCH_STEPS: 128,
  /** The share of a ray's budget (`RAY_WORK`, its lighting's shadow rays included) a reflection's proxy
   *  ray walks on an image drawn for a move, one over this (`proxy.ts`): 512 / 8 = 64 units, the
   *  placement tree walked nearest first (`treeWalkWgsl.ts`). That image is replaced by the next; a
   *  ray that spends its share is no answer, its share the field's. A still view's quiet images walk
   *  the whole budget: they are the images it holds, a ray exhausted there would darken the held
   *  image, and their cost is bounded — `REFLECTION_STILL` + 1 images, then the view freezes and
   *  traces nothing. Measured at 2056×1144 on the bench's open world, M2 class: the trace 2.95 ms in
   *  orbit (5.0 ms with the tree walked in index order, the walk 66 % of it), the walk 3.4·10⁹ units
   *  a second; a still view frozen 0.48 ms, frames held, the trace 0. */
  REFLECTION_MOVING_SHARE: 8,
} as const

/** The period of the per-image sample sequence (`sampleWgsl.ts`, `spatialWgsl.ts`): the turn wraps
 *  on it once, on the CPU (`stageReflectionImage`), so the word the shaders read stays below it and
 *  exact in an `f32`. */
export const REFLECTION_SEQUENCE = 4096

/** Threads per side of a reflection workgroup: one pixel or one texel each. */
export const REFLECTION_SIDE = 8
