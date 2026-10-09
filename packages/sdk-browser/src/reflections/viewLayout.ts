import { fieldLayout } from '../webgpu/blend/fieldLayout.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { hizDepthWgsl } from '../gpu/hiz/pyramidTexture.ts'

/**
 * The reflection's view (`ReflectionView`, `writeReflectionView`), its fields in one table, in
 * order: the depth's view-projection and its inverse, the view-projection the radiance pyramid's
 * image was drawn with, the eye (`w` 0 under an orthographic camera, its direction then), the drawn
 * size and the world size of a pixel at a unit clip `w` (`screen.z`), the radiance image's drawn
 * size and its top level (`radiance.z`), whether the screen is traced this image (`counts.x`: the
 * depth pyramid holds this image's depth and the radiance pyramid an earlier image of this view)
 * and the display curve's rank (`counts.y`), the background as the display shows it, in linear,
 * and the exposure (`display`), and the radiance around the scene a miss adds to the environment's
 * (`surroundings`, written on the GPU from them).
 */
const LAYOUT = fieldLayout('ReflectionView', [
  ['viewProj', 'mat4x4f'],
  ['inverseViewProj', 'mat4x4f'],
  ['radianceViewProj', 'mat4x4f'],
  ['camera', 'vec4f'],
  ['screen', 'vec4f'],
  ['radiance', 'vec4f'],
  ['counts', 'vec4u'],
  ['display', 'vec4f'],
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

/** The binding from which the reflection group holds the depth pyramid (`hizDepthEntries`). */
export const REFLECTION_DEPTH_BINDING = 3

/** The reflection's resources, in bind group `group`: its view (`REFLECTION_VIEW_WGSL`), the
 *  radiance pyramid and its trilinear sampler, then the depth it marches, the engine's pyramid
 *  (`hizDepthWgsl`). */
export const reflectionBindingsWgsl = (group: number) =>
  wgslBlock(
    `reflectionBindingsWgsl(${group})`,
    [REFLECTION_VIEW_WGSL, hizDepthWgsl(group, REFLECTION_DEPTH_BINDING)],
    `@group(${group}) @binding(0) var<uniform> reflectionView:ReflectionView;
@group(${group}) @binding(1) var reflectionRadiance:texture_2d<f32>;
@group(${group}) @binding(2) var reflectionSampler:sampler;`,
  )
