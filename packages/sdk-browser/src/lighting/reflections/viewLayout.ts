import { fieldLayout } from '../../gpu/core/fieldLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { slabPerspective } from '../../../../math/src/wgsl/projection.ts'
import { hizDepthWgsl } from '../../visibility/hiz/gpu/pyramidTexture.ts'
import { VIEW_WGSL, WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { skyLightReadWgsl } from '../../modules/sky/skyLight/read.ts'

/**
 * The reflection's view (`ReflectionView`, `writeReflectionView`), its fields in one table, in
 * order: what the reflection knows of the view beyond the deferred lighting's own (`View`: the
 * pixel's world point, the eye, the drawn size, the exposure, the display curve and the background
 * are read there, from the one uniform every pass of the image reads).
 *  - `viewProj`, the view-projection the depth was drawn with, and `radianceViewProj`, the one the
 *    radiance pyramid's image was drawn with;
 *  - `radiance`, the radiance image's drawn size and its top level (`z`), and the reciprocal of the
 *    pre-exposure its light was written multiplied by (`w`);
 *  - `slab`, the geometry of a surface's thickness (`screenBack`): the world size of a pixel at
 *    a unit clip `w` (`x`), the depth at an infinite distance under a perspective, the eye's plane
 *    under an orthographic projection (`y`), its numerator over the distance, the depth a pixel's
 *    thickness spans (`z`), and whether the projection is a perspective (`w`);
 *  - `thickness`, the share of a surface's depth the reference walk takes for its thickness:
 *    `hizRelativeDepthThickness` times the projection's scale, `screenRelativeThickness`;
 *  - `traced`, whether the screen is traced this image (`x`: the depth pyramid holds this image's
 *    depth and the radiance pyramid an earlier image of this view);
 *  - `front`, whether this image's trace answers the transparents' front surface (`x`, one or zero,
 *    `frontLayer.ts`);
 *  - `temporal`, the reflections' turn (`x`: the image's rank in the samples' sequence, advanced
 *    every image, `stageReflectionImage`; `yzw` unused);
 *  - `grid`, the grid's extent over the drawn size (`xy`, `gridExtent`, `grids.ts`; `zw` unused);
 *  - `surroundings`, the radiance a ray that leaves the scene reaches (`reflectionEnvironment`):
 *    the background the screen draws, through the exposure and the display curve
 *    (`createSurroundings`, `../toneUnmap.ts`);
 *  - `scene`, what a ray may spend (`../../../../sdk-core/src/contracts/reflectionOptions.ts`):
 *    the iterations of its march of the screen (`x`), the work (`y`) and the triangle tests (`z`) of its
 *    walk of each ring of the scene, in the tracer's units, and whether the scene is traced at all (`w`,
 *    one or zero: the one switch of the scene trace, `screenProbeSceneTraces`).
 */
const LAYOUT = fieldLayout('ReflectionView', [
  ['viewProj', 'mat4x4f'],
  ['radianceViewProj', 'mat4x4f'],
  ['radiance', 'vec4f'],
  ['slab', 'vec4f'],
  ['thickness', 'f32'],
  ['traced', 'vec4u'],
  ['front', 'vec4u'],
  ['temporal', 'vec4u'],
  ['grid', 'vec4u'],
  ['surroundings', 'vec4f'],
  ['scene', 'vec4u'],
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

/** The binding of the reflection's view (`ReflectionView`) in the reflection group. */
export const REFLECTION_VIEW_BINDING = 0

/** The binding of the radiance pyramid's trilinear sampler in the reflection group. */
export const REFLECTION_SAMPLER_BINDING = 2

/** The binding from which the reflection group holds the depth pyramid (`hizDepthEntries`), three
 *  bindings. */
export const REFLECTION_DEPTH_BINDING = 3

/** The binding of the deferred lighting's view in the reflection group (`View`). */
export const REFLECTION_LIGHT_VIEW_BINDING = 7

/** The binding of the radiance pyramid in the reflection group: the HDR target the last image lit,
 *  the lit image itself at its level 0 and level `k` at its mip `k` (`radiance/radiance.ts`). */
export const REFLECTION_IMAGE_BINDING = 9

/** The binding of the transparents' front depth in the reflection group (`frontLayer.ts`). */
export const REFLECTION_FRONT_BINDING = 10

/** Where the reflection group holds the sky light's resources (`skyLightReadWgsl`): its cubes, their
 *  sampler, the harmonics and the view's uniform, so that the trace, the screen probes and the forward
 *  passes that bounce light read the sky as the reflection does. */
export const REFLECTION_SKY_LIGHT = {
  group: REFLECTION_GROUP,
  cube: 11,
  sampler: 12,
  harmonics: 13,
  params: 14,
} as const

/**
 * The reflection's resources, in bind group `group`: its view (`REFLECTION_VIEW_WGSL`), the
 * radiance pyramid — one texture (`reflectionImage`): the lit image at level 0, level `k` at mip
 * `k` — and its trilinear sampler, the depth it
 * marches, the engine's pyramid (`hizDepthWgsl`); and `reflectionPixelAt`, the world size of a
 * pixel at the point `P` — its clip `w` times the pixel at a unit `w` (`slab.x`). The program names the deferred lighting's view (`view`, the pixel's world point
 * `worldAt`, the eye `viewToEye`, the drawn size, the exposure, the display curve, the background)
 * itself: it already has it, or declares it in this group (`reflectionLightViewWgsl`).
 */
export const reflectionBindingsWgsl = (group: number) =>
  wgslBlock(
    `reflectionBindingsWgsl(${group})`,
    [
      REFLECTION_VIEW_WGSL,
      hizDepthWgsl(group, REFLECTION_DEPTH_BINDING),
      WORLD_AT_WGSL,
      skyLightReadWgsl({ ...REFLECTION_SKY_LIGHT, group }),
    ],
    `@group(${group}) @binding(${REFLECTION_VIEW_BINDING}) var<uniform> reflectionView:ReflectionView;
@group(${group}) @binding(${REFLECTION_SAMPLER_BINDING}) var reflectionSampler:sampler;
@group(${group}) @binding(${REFLECTION_IMAGE_BINDING}) var reflectionImage:texture_2d<f32>;
fn reflectionPixelAt(P:vec3f)->f32{return (reflectionView.viewProj*vec4f(P,1.0)).w*reflectionView.slab.x;}`,
  )

/**
 * A clip point's depth that grows linearly along the view (`reflectionLinearDepth`): its `w` under a perspective,
 * its `z` under an orthographic projection (`ReflectionView.slab`), and the one of a world point in this view
 * (`surfaceLinearDepth`): the engine's one depth for both projections, which a program that declares the
 * reflection's view (`reflectionBindingsWgsl`) lists beside it.
 */
export const REFLECTION_LINEAR_DEPTH_WGSL = wgslBlock(
  'REFLECTION_LINEAR_DEPTH_WGSL',
  [REFLECTION_VIEW_WGSL, slabPerspective],
  `fn reflectionLinearDepth(clip:vec4f)->f32{return select(clip.z,clip.w,slabPerspective(reflectionView.slab));}
fn surfaceLinearDepth(P:vec3f)->f32{return reflectionLinearDepth(reflectionView.viewProj*vec4f(P,1.0));}`,
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
