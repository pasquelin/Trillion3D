import { fieldLayout } from '../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { hizDepthWgsl } from '../gpu/hiz/pyramidTexture.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from '../lighting/deferred/worldAtWgsl.ts'

/**
 * The reflection's view (`ReflectionView`, `writeReflectionView`), its fields in one table, in
 * order: what the reflection knows of the view beyond the deferred lighting's own (`View`: the
 * pixel's world point, the eye, the drawn size, the exposure, the display curve and the background
 * are read there, from the one uniform every pass of the image reads).
 *  - `viewProj`, the view-projection the depth was drawn with, `radianceViewProj`, the one the
 *    radiance pyramid's image was drawn with, and `radianceInverse`, its inverse: the transparents'
 *    front depth of that image is carried to this one's pixels with the two (`frontDepth.ts`);
 *  - `radiance`, the radiance image's drawn size and its top level (`z`);
 *  - `slab`, the geometry of a surface's thickness (`reflectionBack`): the world size of a pixel at
 *    a unit clip `w` (`x`), the depth at an infinite distance (`y`), the depth a pixel's thickness
 *    spans under an orthographic projection (`z`), and whether the projection is a perspective
 *    (`w`);
 *  - `traced`, whether the screen is traced this image (`x`: the depth pyramid holds this image's
 *    depth and the radiance pyramid an earlier image of this view), this image's drawn size
 *    (`yz`) and the words of a row of the front depth's buffer (`w`);
 *  - `proxy`, the resident proxy's certified error in metres (`x`), the distance a ray leaves a surface
 *    off its normal;
 *  - `surroundings`, the background as the view shows it, the radiance a ray that leaves the scene reaches (`reflectionEnvironment`), written on the
 *    GPU from the background, the exposure and the display curve (`BEGIN_SHADER`).
 */
const LAYOUT = fieldLayout('ReflectionView', [
  ['viewProj', 'mat4x4f'],
  ['radianceViewProj', 'mat4x4f'],
  ['radianceInverse', 'mat4x4f'],
  ['radiance', 'vec4f'],
  ['slab', 'vec4f'],
  ['traced', 'vec4u'],
  ['proxy', 'vec4f'],
  ['surroundings', 'vec4f'],
] as const)

/** Each field's first word in the view. */
export const REFLECTION_VIEW_AT = LAYOUT.at
/** Bytes of the reflection's view uniform. */
export const REFLECTION_VIEW_BYTES = LAYOUT.words * 4
/** Words of it the CPU writes: all but `surroundings`, which the GPU writes. */
export const REFLECTION_VIEW_WRITTEN_WORDS = LAYOUT.at.surroundings
export const REFLECTION_VIEW_WGSL = wgslBlock('REFLECTION_VIEW_WGSL', [], LAYOUT.wgsl)

/** The bind group the reflection's resources take in every program that marches: the opaque
 *  trace's and the forward passes'. */
export const REFLECTION_GROUP = 1

/** The binding from which the reflection group holds the depth pyramid (`hizDepthEntries`), four
 *  bindings. */
export const REFLECTION_DEPTH_BINDING = 3

/** The binding of the deferred lighting's view in the reflection group (`View`). */
export const REFLECTION_LIGHT_VIEW_BINDING = 7
/** The binding of the proxy's surface cache in the reflection group (`bounce/surface.ts`). */
export const REFLECTION_SURFACE_BINDING = 8

/**
 * The reflection's resources, in bind group `group`: its view (`REFLECTION_VIEW_WGSL`), the
 * radiance pyramid and its trilinear sampler, the depth it marches, the engine's pyramid
 * (`hizDepthWgsl`), and the radiance the resident proxy's surfaces hold (`surface`, the cache the
 * bounce sweeps). The program names the deferred lighting's view (`view`, the pixel's world point
 * `worldAt`, the eye `viewToEye`, the drawn size, the exposure, the display curve, the background)
 * itself: it already has it, or declares it in this group (`reflectionLightViewWgsl`).
 */
export const reflectionBindingsWgsl = (group: number) =>
  wgslBlock(
    `reflectionBindingsWgsl(${group})`,
    [REFLECTION_VIEW_WGSL, hizDepthWgsl(group, REFLECTION_DEPTH_BINDING), WORLD_AT_WGSL],
    `@group(${group}) @binding(0) var<uniform> reflectionView:ReflectionView;
@group(${group}) @binding(1) var reflectionRadiance:texture_2d<f32>;
@group(${group}) @binding(2) var reflectionSampler:sampler;
@group(${group}) @binding(${REFLECTION_SURFACE_BINDING}) var surface:texture_2d<f32>;`,
  )

/** The deferred lighting's view in the reflection group, for a program that has none of its own. */
export const reflectionLightViewWgsl = (group: number) =>
  wgslBlock(
    `reflectionLightViewWgsl(${group})`,
    [VIEW_WGSL],
    `@group(${group}) @binding(${REFLECTION_LIGHT_VIEW_BINDING}) var<uniform> view:View;`,
  )
