import { DEG2RAD } from '../../../../math/src/constants.ts'

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
  /** The thickness of a surface the march assumes, in pixels of its footprint: a ray behind a
   *  pixel's surface by more passes behind it and goes on (a pole, a fence), by less is inside it
   *  and hits. The same thickness at every depth and under every projection (`screenBack`). */
  REFLECTION_THICKNESS: 4,
  /** The weight under which a stage of the chain is not evaluated: 2⁻¹¹, under half a step of an
   *  8-bit channel of a radiance of one. */
  REFLECTION_EPSILON: 2 ** -11,
  /** The coverage from which a blended fragment is a surface of the depth a ray meets
   *  (`fsFront`, `../../blend/frontStageWgsl.ts`): one that hides more than half of what lies behind it. A fainter one
   *  tints its backdrop and is no wall to a ray. */
  REFLECTION_FRONT_COVERAGE: 0.5,
  /** The bound of the half-vector's angle (`REFLECTION_CONE_WGSL`): tan 40°. */
  REFLECTION_CONE_LIMIT: Math.tan(40 * DEG2RAD),
  /** The distance past which a ray is taken as infinite: 2²³ world units, where a float32 no
   *  longer holds a unit step. */
  REFLECTION_FAR: 2 ** 23,
  /** The same-surface test's normals (`reflectionSameSurface`): two normals within this angle's cosine
   *  are one surface, whole. A normal map tilts a pixel's normal from its neighbours' by up to about
   *  20° on a bumpy road: a test that weighed it down (a power of N·Nₜ) would let one neighbour of
   *  several answer a pixel, and show blocks. Cos 25°. */
  REFLECTION_CREASE_NEAR: Math.cos(25 * DEG2RAD),
  /** The same-surface test's crease: normals this far apart and more (cos 50°) are two surfaces — a
   *  modelled body's edge is 45° or more —, the weight falling smoothly from `REFLECTION_CREASE_NEAR`. */
  REFLECTION_CREASE_FAR: Math.cos(50 * DEG2RAD),
  /** The least N·V the same-surface test (`reflectionSameSurface`) divides by: a surface seen this
   *  close to edge-on spans ⌈1/8⌉ = eight pixels' depth across a pixel, a steeper one no more. */
  REFLECTION_GRAZING: 1 / 8,
  /** The temporal clamp's width (`temporalWgsl.ts`), in standard deviations of the resolved pixels
   *  around a pixel, or of the history's own images where wider: a history further from their mean
   *  than this is pulled back to it — one deviation keeps a moving reflection from ghosting and still
   *  lets a noisy one average. */
  REFLECTION_CLAMP: 1,
  /** The relative depth past which a history texel is another surface than the pixel reprojected onto
   *  it (`temporalWgsl.ts`): 3 %, past a depth buffer's and a reprojection's error, under a modelled
   *  step's; jittered by half of it either way, so the cut is no hard line, and widened as the surface
   *  turns edge-on, where one pixel spans more depth. */
  REFLECTION_HISTORY_DISTANCE: 0.03,
  /** The least extent of that window the clamp's move is measured against (`temporalPixel`), in
   *  the display's white (the view's exposure applied): the window's extent, held at 0.1 at least,
   *  a tenth of the display's white. A window of near-equal texels — a smooth glass reflecting a
   *  smooth sky — has a width near zero, against which any history moved across the whole window and
   *  counted for a quarter of its images, image after image. */
  REFLECTION_CLAMP_FLOOR: 0.1,
  /** The share of the visible normals' cap, nearest the horizon, a sampled ray is never drawn from
   *  (`sampleWgsl.ts`): the grazing microfacets, whose rays leave nearly along the surface, are rarely
   *  seen, dim and the noisiest of a lobe; a tenth of the cap's height left out removes their flicker
   *  for a share of the lobe's energy under its noise. */
  REFLECTION_TAIL_BIAS: 0.1,
  /** The range of the denoiser's space (`texelWgsl.ts`), in the display's white (the view's exposure
   *  applied): a radiance under it is averaged as itself, one past it weighs as about the range — ten,
   *  so every highlight a display shows is averaged whole, and a firefly a thousand times brighter than
   *  its neighbours weighs ten. */
  REFLECTION_DENOISER_RANGE: 10,
  /** The roughness past which a lobe casts no ray (`reach.ts`), the probes' field answering it whole:
   *  past it a traced reflection is too blurred to beat the probes' field, so no ray is spent. A pixel no
   *  lobe of which traces is never in a traced tile's grid (`tiles.ts`): it reads the field alone. */
  REFLECTION_TRACE_ROUGHNESS: 0.4,
  /** The roughness band under `REFLECTION_TRACE_ROUGHNESS` over which a lobe's ray gives way to the
   *  field (`reflectionTraceShare`): whole under 0.3. */
  REFLECTION_TRACE_FADE: 0.1,
  /** The floor of the reflections' normalised lengths (`ReflectionLobe.T`, a footprint's direction),
   *  of a sum of upsample weights and of a hit's slab: under it, the value is none. Under math's
   *  `DIVISOR_FLOOR` (1e-20) on purpose: these values can fall between the two — an axis a hair
   *  off the reflection, a neighbour's faint weight, a slab at a far depth —, where 1e-20 would
   *  shorten the normalised vector or scale the weighted mean down instead of normalising it. */
  REFLECTION_FLOOR: 1e-30,
  /** The images a history counts under which the last pass's spatial filter runs, boosted the more
   *  the fewer (`bilateralWgsl.ts`, its disocclusion): two, past which the history's own average is
   *  less noisy than the filter's blur. */
  REFLECTION_DISOCCLUSION_FRAMES: 2,
  /** The spatial filter's radius at a roughness of ⅛ and over, in pixels (`bilateralWgsl.ts`): as
   *  wide as the widest spatial reuse (`REFLECTION_REUSE_RADIUS`), the blur a disoccluded pixel takes
   *  for the images it lacks. */
  REFLECTION_FILTER_RADIUS: 8,
} as const

/**
 * The integer constants of the reflection's shaders, one table, printed as `u32` (`REFLECTION_COUNTS_WGSL`).
 * What a ray may spend — the screen march's iterations, the steps of its walk of each ring of the scene — is
 * not here: those are settings with the reference's defaults (`reflectionOptions.ts`), read from the view
 * (`ReflectionView.scene`).
 */
export const REFLECTION_COUNTS = {
  /** The images a pixel's history averages at most (`temporalWgsl.ts`), on every image, whatever moves
   *  elsewhere in the scene: 12 — a dozen images of a ray and its reused neighbours each, about a
   *  hundred samples of a lobe, the window an exponential mean then keeps; a history held far by the
   *  clamp counts for fewer (`historyCount`, not rounded). */
  REFLECTION_HISTORY: 12,
  /** The widest spatial reuse, in pixels (`resolveWgsl.ts`): the lobe's own reach bounds it below this,
   *  which a ray that met the far scene through a wide lobe reaches. */
  REFLECTION_REUSE_RADIUS: 8,
  /** The neighbours the resolve's reconstruction reads at most (`resolveWgsl.ts`), on a disc of its
   *  radius: five — with the pixel's own ray and a history of `REFLECTION_HISTORY` images, about
   *  seventy samples of a lobe. */
  REFLECTION_REUSE_TAPS: 5,
  /** The neighbours the last pass's spatial filter reads (`bilateralWgsl.ts`), twice as many at a full
   *  disocclusion: few, since it runs only where the history is short. */
  REFLECTION_FILTER_TAPS: 4,
  /** The side of the blocks of pixels the reflections trace one ray of each image (`trace/trace.ts`),
   *  two — one ray a pixel is the full rate, past two a block's pixels share too little of its ray —, a
   *  quarter of the rays for the same image: the pixel of each 2 × 2 block the tile jitter picks
   *  (`reflectionJitter`, `reflectionTracedPixel`) casts the block's ray where its lobe traces, the
   *  four rooks taking turns image after image, and every pixel resolves its own answer from the rays
   *  around it (`resolveWgsl.ts`). A still view traces every traced pixel within four
   *  images, within its history's twelve. */
  REFLECTION_TRACE_BLOCK: 2,
} as const

/** The period of the per-image sample sequence (`sampleWgsl.ts`, `viewWrite.ts`): the turn wraps
 *  on it once, on the CPU (`stageReflectionImage`), so the word the shaders read stays below it and
 *  exact in an `f32`. */
export const REFLECTION_SEQUENCE = 4096

/** Threads per side of a reflection workgroup: one pixel or one texel each. */
export const REFLECTION_SIDE = 8
