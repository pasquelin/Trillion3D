import { DEG2RAD, HALF_PI } from '../../../../math/src/constants.ts'
import { CENTIMETRES_PER_METRE } from '../../../../sdk-core/src/page/format.ts'

/**
 * The constants of the reflection's shaders, by the name they read, one table: the WGSL block is
 * printed from it (`REFLECTION_CONSTANTS_WGSL`, each the `f32` nearest its value) and the tests
 * that state a rule in their terms read it here.
 */
export const REFLECTION_CONSTANTS = {
  /** The image border, a fraction of its height, over which a hit fades into the next stage. */
  REFLECTION_EDGE: 1 / 16,
  /** The thickness of a surface the march assumes, in pixels of its footprint: a ray behind a
   *  pixel's surface by more passes behind it and goes on (a pole, a fence), by less is inside it
   *  and hits. The same thickness at every depth and under every projection (`screenBack`). The
   *  planes' march (`hizTrace` `'planes'`) reads it; the reference's walk takes
   *  a share of the surface's depth instead (`reflectionRelativeDepthThickness`). */
  REFLECTION_THICKNESS: 4,
  /** The roughness of the top layer from which the history of a pixel traced at full resolution has all the images the
   *  setting gives it: under it the history is lerped down to two images, a mirror's noise left to the temporal
   *  anti-aliasing. */
  REFLECTION_MIRROR_ROUGHNESS: 0.05,
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
  /** The least extent of that window the clamp's move is measured against (`temporalPixel`), in
   *  the display's white (the view's exposure applied): the window's extent, held at 0.1 at least,
   *  a tenth of the display's white. A window of near-equal texels — a smooth glass reflecting a
   *  smooth sky — has a width near zero, against which any history moved across the whole window and
   *  counted for a quarter of its images, image after image. */
  REFLECTION_CLAMP_FLOOR: 0.1,
  /** The floor of the reflections' normalised lengths, of a sum of upsample weights and of a hit's slab: under it, the value is none. Under math's
   *  `DIVISOR_FLOOR` (1e-20) on purpose: these values can fall between the two — an axis a hair
   *  off the reflection, a neighbour's faint weight, a slab at a far depth —, where 1e-20 would
   *  shorten the normalised vector or scale the weighted mean down instead of normalising it. */
  REFLECTION_FLOOR: 1e-30,
  /** The unit of the global distance field in the engine's metre: a ray marched through the field is
   *  carried to centimetres, and what it finds back. */
  REFLECTION_CENTIMETRES: CENTIMETRES_PER_METRE,
  /** The half voxels of the clipmap that holds the point the screen stopped knowing a ray at, by which the march
   *  through the field begins before it: the surface expansion needs a start outside the surface. */
  REFLECTION_PULLBACK: 4,
  /** The factor of a march's step, drawn about 1 near a mirror between this and its reciprocal, and the cone angle
   *  (π/256) from which it is no longer drawn. */
  REFLECTION_STEP_DITHER: 0.95,
  REFLECTION_STEP_DITHER_CONE: HALF_PI / 128,
  /** The least angle of the cone of a ray, whatever its lobe's sampling density says. */
  REFLECTION_MIN_CONE: 0.00001,
} as const

/**
 * The integer constants of the reflection's shaders, one table, printed as `u32` (`REFLECTION_COUNTS_WGSL`).
 * What a ray may spend — the screen march's iterations, the steps of its march through the global distance
 * field (`GLOBAL_DISTANCE_FIELD_TRACE_MAX_STEPS`) — is not here: the first is a setting with the reference's default,
 * read from the view (`ReflectionView.scene`), the second the field's block's.
 */
export const REFLECTION_COUNTS = {
  /** The bits of the view's flags (`ReflectionView.scene.z`, `reflectionOptions.ts`): the scene is traced, the screen
   *  looked at again past the field, the screen traced, the history accumulated, the neighbours' rays read, the
   *  last filter run, a scene hit taking the lit image, the lighting fogged along its ray, a scene hit read on the finest
   *  page of the cache. */
  REFLECTION_SCENE_TRACES: 1,
  REFLECTION_DISTANT_TRACES: 2,
  REFLECTION_SCREEN_TRACES: 4,
  REFLECTION_TEMPORAL: 8,
  REFLECTION_RECONSTRUCTION: 16,
  REFLECTION_BILATERAL: 32,
  REFLECTION_SCENE_COLOR: 64,
  REFLECTION_HEIGHT_FOG: 128,
  REFLECTION_HI_RES_SURFACE: 256,
} as const

/** Threads per side of a reflection workgroup: one pixel or one texel each. */
export const REFLECTION_SIDE = 8
