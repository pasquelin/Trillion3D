import { fieldLayout } from '../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { hizDepthWgsl } from '../gpu/hiz/pyramidTexture.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from '../lighting/deferred/worldAtWgsl.ts'

/**
 * The reflection's view (`ReflectionView`, `writeReflectionView`), its fields in one table, in
 * order: what the reflection knows of the view beyond the deferred lighting's own (`View`: the
 * pixel's world point, the eye, the drawn size, the exposure, the display curve and the background
 * are read there, from the one uniform every pass of the image reads).
 *  - `viewProj`, the view-projection the depth was drawn with, and `radianceViewProj`, the one the
 *    radiance pyramid's image was drawn with;
 *  - `radiance`, the radiance image's drawn size and its top level (`z`);
 *  - `slab`, the geometry of a surface's thickness (`screenBack`): the world size of a pixel at
 *    a unit clip `w` (`x`), the depth at an infinite distance (`y`), the depth a pixel's thickness
 *    spans under an orthographic projection (`z`), and whether the projection is a perspective
 *    (`w`);
 *  - `traced`, whether the screen is traced this image (`x`: the depth pyramid holds this image's
 *    depth and the radiance pyramid an earlier image of this view) and this image's drawn size
 *    (`yz`);
 *  - `proxy`, the resident proxy's certified error in metres (`x`), the distance a ray leaves a surface
 *    off its normal;
 *  - `front`, whether this image's trace answers the transparents' front surface (`x`, one or zero,
 *    `frontLayer.ts`);
 *  - `temporal`, the reflections' turn (`x`: the image's rank in the picks of a 2×2 block and the
 *    samples' sequence, held while the view is frozen) and the images drawn since the last change
 *    (`y`, `RadianceSettle.quiet`, capped): what the accumulation clamps and freezes by
 *    (`temporalWgsl.ts`);
 *  - `surroundings`, the radiance a ray that leaves the scene reaches (`reflectionEnvironment`):
 *    the background the screen draws, through the exposure and the display curve
 *    (`createSurroundings`, `../lighting/toneUnmap.ts`).
 */
const LAYOUT = fieldLayout('ReflectionView', [
  ['viewProj', 'mat4x4f'],
  ['radianceViewProj', 'mat4x4f'],
  ['radiance', 'vec4f'],
  ['slab', 'vec4f'],
  ['traced', 'vec4u'],
  ['proxy', 'vec4f'],
  ['front', 'vec4u'],
  ['temporal', 'vec4u'],
  ['surroundings', 'vec4f'],
] as const)

/** Each field's first word in the view. */
export const REFLECTION_VIEW_AT = LAYOUT.at
/** Bytes of the reflection's view uniform. */
export const REFLECTION_VIEW_BYTES = LAYOUT.words * 4
/** Words of the reflection's view, every one the CPU's. */
export const REFLECTION_VIEW_WORDS = LAYOUT.words
export const REFLECTION_VIEW_WGSL = wgslBlock('REFLECTION_VIEW_WGSL', [], LAYOUT.wgsl)

/** The bind group the reflection's resources take in every program that marches: the opaque
 *  trace's and the forward passes'. */
export const REFLECTION_GROUP = 1

/** The binding of the radiance pyramid's trilinear sampler in the reflection group. */
export const REFLECTION_SAMPLER_BINDING = 2

/** The binding from which the reflection group holds the depth pyramid (`hizDepthEntries`), three
 *  bindings. */
export const REFLECTION_DEPTH_BINDING = 3

/** The binding of the deferred lighting's view in the reflection group (`View`). */
export const REFLECTION_LIGHT_VIEW_BINDING = 7

/** The binding of the radiance pyramid in the reflection group: the HDR target the last image lit,
 *  the lit image itself at its level 0 and level `k` at its mip `k` (`radiance.ts`). */
export const REFLECTION_IMAGE_BINDING = 9

/** The binding of the transparents' front depth in the reflection group (`frontLayer.ts`). */
export const REFLECTION_FRONT_BINDING = 10

/**
 * The reflection's resources, in bind group `group`: its view (`REFLECTION_VIEW_WGSL`), the
 * radiance pyramid — one texture (`reflectionImage`): the lit image at level 0, level `k` at mip
 * `k` — and its trilinear sampler, the depth it
 * marches, the engine's pyramid (`hizDepthWgsl`). The program names the deferred lighting's view (`view`, the pixel's world point
 * `worldAt`, the eye `viewToEye`, the drawn size, the exposure, the display curve, the background)
 * itself: it already has it, or declares it in this group (`reflectionLightViewWgsl`).
 */
export const reflectionBindingsWgsl = (group: number) =>
  wgslBlock(
    `reflectionBindingsWgsl(${group})`,
    [REFLECTION_VIEW_WGSL, hizDepthWgsl(group, REFLECTION_DEPTH_BINDING), WORLD_AT_WGSL],
    `@group(${group}) @binding(0) var<uniform> reflectionView:ReflectionView;
@group(${group}) @binding(${REFLECTION_SAMPLER_BINDING}) var reflectionSampler:sampler;
@group(${group}) @binding(${REFLECTION_IMAGE_BINDING}) var reflectionImage:texture_2d<f32>;`,
  )

/** The deferred lighting's view in the reflection group, for a program that has none of its own. */
export const reflectionLightViewWgsl = (group: number) =>
  wgslBlock(
    `reflectionLightViewWgsl(${group})`,
    [VIEW_WGSL],
    `@group(${group}) @binding(${REFLECTION_LIGHT_VIEW_BINDING}) var<uniform> view:View;`,
  )

/** The transparents' front surface as a program of the reflection group `group` reads it
 *  (`frontLayer.ts`): whether this image's trace answered it (`reflectionView.front.x`), and its depth
 *  at a pixel — the front pass's own depth. One reading for the trace and the forward programs. */
export const reflectionFrontWgsl = (group: number) =>
  wgslBlock(
    `reflectionFrontWgsl(${group})`,
    [reflectionBindingsWgsl(group)],
    `@group(${group}) @binding(${REFLECTION_FRONT_BINDING}) var reflectionFront:texture_2d<f32>;
fn reflectionFrontTraced()->bool{return reflectionView.front.x!=0u;}
fn reflectionFrontDepth(coord:vec2i)->f32{return textureLoad(reflectionFront,coord,0).r;}`,
  )
