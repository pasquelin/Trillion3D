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
 *    lit image was drawn with;
 *  - `radiance`, the lit image's drawn size (`xy`; `z` unused), and the reciprocal of the
 *    pre-exposure its light was written multiplied by (`w`);
 *  - `slab`, the geometry of a surface's thickness (`screenBack`): the world size of a pixel at
 *    a unit clip `w` (`x`), the depth at an infinite distance under a perspective, the eye's plane
 *    under an orthographic projection (`y`), its numerator over the distance, the depth a pixel's
 *    thickness spans (`z`), and whether the projection is a perspective (`w`);
 *  - `thickness`, the share of a surface's depth the reference walk takes for its thickness:
 *    `reflectionRelativeDepthThickness` times the projection's scale, `screenRelativeThickness`;
 *  - `historyThickness`, how far the depth the last image kept where a screen hit lands may lie from the depth the hit is expected
 *    at there, in device depth: `reflectionHistoryDepthTestRelativeThickness` times the projection's scale (`screenRelativeThickness`);
 *  - `reconstructionScale`, the scale of the roughness the reconstruction weighs the neighbours' rays on
 *    (`reflectionReconstructionRoughnessScale`);
 *  - `traced`, whether the screen is traced this image (`x`: the depth pyramid holds this image's
 *    depth and the view an earlier lit image of it, which no cut of the view since has made another) and whether the depth the last image kept is
 *    that of the lit image held (`y`, `ReflectionFrame.depthKept`: else a hit's expected depth is compared with this image's);
 *  - `front`, whether this image's trace answers the transparents' front surface (`x`, one or zero,
 *    `frontLayer.ts`), and the blocks of pixels a texel of the front layer traces one ray of, across and down
 *    (`yz`, which the scene's water may set apart from the level's, even not square);
 *  - `temporal`, the reflections' turn (`x`: the image's rank in the samples' sequence, advanced
 *    every image, `stageReflectionImage`; `y`: the frame index modulo eight, which dithers the noise of the hits, the
 *    resolve's discs, the history's clamp and the march's step; `z`: the frame index itself, which turns the pixel a block of
 *    pixels traces its ray from, `reflectionJitter`, whatever the period of the ray directions; `w` unused);
 *  - `grid`, the grid's extent over the drawn size (`xy`, `gridExtent`, `grids.ts`), the blocks of pixels a texel
 *    traces one ray of, across (`z`) and down (`w`, the level's row: the same unless the checkerboard);
 *  - `scene`, what a ray may spend (`../../../../sdk-core/src/contracts/reflectionOptions.ts`): the iterations of
 *    its march of the screen (`x`) and the steps of the far screen trace (`y`), and the flags of what is traced
 *    and done (`z`, `REFLECTION_SCENE_TRACES` and the bits after it; `w` the front layer's, whose denoising
 *    switches the scene's water may set apart);
 *  - `reach`, the metres a ray leaves a surface by at least (`x`) and the far screen trace's length (`y`), the roughness past which a lobe of a foliage pixel — the thin transmission's models — casts no ray (`z`), and the scale of the bilateral filter's depth weight (`w`);
 *  - `march`, the thickness of a surface of the screen march as a share of its depth (`x`), the far trace's slope
 *    tolerance (`y`) and offset bias (`z`), the longest ray (`w`);
 *  - `light`, the most radiance a ray brings back (`x`), the depth thickness (`y`) and the cosine of the facing
 *    (`z`) with which a scene hit takes the lit image, the length the sky is fogged over at least (`w`);
 *  - `denoise`, the images a history holds (`x`), the clamp's scale (`y`), the history's distance threshold (`z`),
 *    the tonemap range (`w`);
 *  - `spread`, the reconstruction's radius (`x`), the bilateral filter's (`y`), the reconstruction's least weight
 *    (`z`), the disocclusion frames (`w`);
 *  - `lobe`, the roughness past which a lobe casts no ray (`x`), the fade to it (`y`), the sampling's bias (`z`), the smooth
 *    bias of every roughness (`w`, `reflectionSmoothed`, `surfacesWgsl.ts`);
 *  - `taps`, the reconstruction's samples (`x`), the bilateral filter's (`y`), the lanes of a subgroup that must still be marching for the screen march to go on (`z`, `occupancy`); `w` unused (the period of the ray directions is the CPU's, `stageReflectionImage`);
 *  - `leak`, the share of the sky light's diffuse light that leaks onto a hit of the scene, by channel (`xyz`: the leaking
 *    times its tint, shared with the screen probes; `w`: the albedo a hit is taken to reflect it with);
 *  - `eyeSpread`, the angle one pixel spans at the eye (`eyeToPixelSpread`, `screenSlab.ts`), none under an orthographic projection;
 *  - `hardware`, for a ray cast through the scene's triangles (`sceneTraceHardware.ts`): the metres it goes along itself at least (`x`), how far its
 *    start is moved off the surface along the normal as far as the ray leans on it (`y`), the metres its start is pulled back from where the screen
 *    stopped knowing it (`z`), and the centimetres a texel of a card may lie from the point it hit (`w`, the surface cache's sampling depth bias);
 *  - `firstPerson`, the sphere that holds the stand-ins of the first-person objects (`firstPersonBounds.ts`): its centre in the world (`xyz`) and its
 *    radius (`w`), none when it is 0; `firstPersonMinimum`, the metres at least a ray the screen missed is handed to the scene trace at when it meets that
 *    sphere (`reflectionClipFirstPerson`, `firstPerson.ts`);
 *  - `jitter`, the device offset the temporal anti-aliasing shifts `viewProj` by (`xy`) and the one it shifted
 *    `radianceViewProj` by (`zw`): what the surfaces' vectors, drawn without it, are compared after.
 */
const LAYOUT = fieldLayout('ReflectionView', [
  ['viewProj', 'mat4x4f'],
  ['radianceViewProj', 'mat4x4f'],
  ['radiance', 'vec4f'],
  ['slab', 'vec4f'],
  ['thickness', 'f32'],
  ['historyThickness', 'f32'],
  ['reconstructionScale', 'f32'],
  ['eyeSpread', 'f32'],
  ['traced', 'vec4u'],
  ['front', 'vec4u'],
  ['temporal', 'vec4u'],
  ['grid', 'vec4u'],
  ['scene', 'vec4u'],
  ['reach', 'vec4f'],
  ['march', 'vec4f'],
  ['light', 'vec4f'],
  ['denoise', 'vec4f'],
  ['spread', 'vec4f'],
  ['lobe', 'vec4f'],
  ['taps', 'vec4u'],
  ['leak', 'vec4f'],
  ['hardware', 'vec4f'],
  ['jitter', 'vec4f'],
  ['firstPerson', 'vec4f'],
  ['firstPersonMinimum', 'f32'],
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

/** The binding from which the reflection group holds the depth pyramid (`hizDepthEntries`), three
 *  bindings. */
export const REFLECTION_DEPTH_BINDING = 3

/** The binding of the deferred lighting's view in the reflection group (`View`). */
export const REFLECTION_LIGHT_VIEW_BINDING = 7

/** The binding of the lit image in the reflection group: the HDR target the last image lit, read as it
 *  is (`litImage.ts`). */
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
 * The reflection's view in bind group `group` — what the forward programs bind (`reflectionForwardLayout`): its
 * view (`REFLECTION_VIEW_WGSL`), the sky light's resources, the side of the blocks of
 * pixels a texel traces (`reflectionBlock`) and whether a flag of the trace is set (`reflectionDone`). The program names the deferred lighting's view (`view`, the pixel's world point
 * `worldAt`, the eye `viewToEye`, the drawn size, the exposure, the display curve, the background)
 * itself: it already has it, or declares it in this group (`reflectionLightViewWgsl`).
 */
const reflectionViewWgsl = (group: number) =>
  wgslBlock(
    `reflectionViewWgsl(${group})`,
    [REFLECTION_VIEW_WGSL, WORLD_AT_WGSL, skyLightReadWgsl({ ...REFLECTION_SKY_LIGHT, group })],
    `@group(${group}) @binding(${REFLECTION_VIEW_BINDING}) var<uniform> reflectionView:ReflectionView;
// The surface a trace kernel works on, 0 the opaque or 1 the transparents' front, set by the
// pipeline (frontLayer.ts); the forward programs leave it at 0.
override REFLECTION_LAYER:u32=0u;
fn reflectionBlock()->vec2u{return select(reflectionView.grid.zw,reflectionView.front.yz,REFLECTION_LAYER==1u);}
fn reflectionDone(bit:u32)->bool{return (select(reflectionView.scene.z,reflectionView.scene.w,REFLECTION_LAYER==1u)&bit)!=0u;}`,
  )

/** The reflection's resources of the trace, in bind group `group`: the view (`reflectionViewWgsl`), the
 *  lit image (`reflectionImage`) and the depth it marches, the engine's pyramid (`hizDepthWgsl`). */
export const reflectionBindingsWgsl = (group: number) =>
  wgslBlock(
    `reflectionBindingsWgsl(${group})`,
    [reflectionViewWgsl(group), hizDepthWgsl(group, REFLECTION_DEPTH_BINDING)],
    `@group(${group}) @binding(${REFLECTION_IMAGE_BINDING}) var reflectionImage:texture_2d<f32>;`,
  )

/**
 * A clip point's depth that grows linearly along the view (`reflectionLinearDepth`): its `w` under a perspective,
 * its `z` under an orthographic projection (`ReflectionView.slab`), and the one of a world point in this view
 * (`surfaceLinearDepth`): the engine's one depth for both projections, which a program that declares the
 * reflection's view (`reflectionViewWgsl`) lists beside it. `reflectionLinearOfDevice` turns a device depth of this view (a depth
 * buffer's, a clip point's `z / w`) back to that depth: under a perspective `z = A + B / w` (`ReflectionView.slab`, `A` its `y`, `B` its
 * `z`), so `w = B / (z - A)`, and a device depth at the far end (`z - A` nil) is as far as a float goes; under an orthographic
 * projection the depth is the device depth itself.
 */
export const REFLECTION_LINEAR_DEPTH_WGSL = wgslBlock(
  'REFLECTION_LINEAR_DEPTH_WGSL',
  [REFLECTION_VIEW_WGSL, slabPerspective],
  `fn reflectionLinearDepth(clip:vec4f)->f32{return select(clip.z,clip.w,slabPerspective(reflectionView.slab));}
fn surfaceLinearDepth(P:vec3f)->f32{return reflectionLinearDepth(reflectionView.viewProj*vec4f(P,1.0));}
fn reflectionLinearOfDevice(z:f32)->f32{
 return select(z,reflectionView.slab.z/max(z-reflectionView.slab.y,1e-30),slabPerspective(reflectionView.slab));
}`,
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
    [reflectionFrontTracedWgsl(group)],
    `@group(${group}) @binding(${REFLECTION_FRONT_BINDING}) var reflectionFront:texture_2d<f32>;
fn reflectionFrontDepth(coord:vec2i)->f32{return textureLoad(reflectionFront,coord,0).r;}`,
  )

/** Whether this image's trace answered the front (`reflectionView.front.x`), alone: the forward programs, which read the front's depth from the traced radiance
 *  (`frontLayer.ts`, `FRONT_TRACED_FORMAT`), bind no depth texture of it. */
export const reflectionFrontTracedWgsl = (group: number) =>
  wgslBlock(
    `reflectionFrontTracedWgsl(${group})`,
    [reflectionViewWgsl(group)],
    `fn reflectionFrontTraced()->bool{return reflectionView.front.x!=0u;}`,
  )
