import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * THE OCCLUSION'S UNIFORM, one for each pass of an image (`writeAoParams`, `params.ts`): the settings the
 * reference's shader reads and the geometry of the pass, in `vec4f`s, named `view` in the shaders —
 *  - `shape`: the power, the bias in thousandths of the depth, the intensity, the blend of the coarser level;
 *  - `reach`: the radius the shader takes (the setting scaled for the pass, in the units of the mode),
 *    whether it is the world's, the pass's scale to the full resolution, the climb of the samples along
 *    the depth pyramid;
 *  - `fade`: the multiplier and the addend of the distance fade, the depth threshold of the setup;
 *  - `lens`: the projection's scale on x and y, and the drawn view's size in pixels;
 *  - `rects`: the size of the pass's drawn rectangle, and of the texture it draws into;
 *  - `low`: the coarser texture's size and its drawn rectangle's, which the upsample reads;
 *  - `upper`: the size of the setup texture the upsample reads the neighbours' normals and depths from;
 *  - `noise`: the offset of the noise block, in texels, for this image;
 *  - `right`, `up`, `forward`: the camera's axes in the world, `forward` looking into the scene;
 *  - `depth`, `radius`: the projection's depth terms, as the temporal passes read them
 *    (`../../post/taa/depthWgsl.ts`, `writeDepthTerms`): a device depth turns into a distance by them.
 * Distances are in centimetres, the unit the search works in.
 */
export const AO_PARAMS = fieldLayout('AoParams', [
  ['shape', 'vec4f'],
  ['reach', 'vec4f'],
  ['fade', 'vec4f'],
  ['lens', 'vec4f'],
  ['rects', 'vec4f'],
  ['low', 'vec4f'],
  ['upper', 'vec4f'],
  ['noise', 'vec4f'],
  ['right', 'vec4f'],
  ['up', 'vec4f'],
  ['forward', 'vec4f'],
  ['depth', 'vec4f'],
  ['radius', 'vec4f'],
] as const)

/** Bytes of the uniform. */
export const AO_PARAMS_BYTES = AO_PARAMS.words * 4

/** The bindings of every occlusion pass's group 0: the uniform, the depth pyramid (`depth`, three bindings), the
 *  surfaces' normals, the setup texture a pass reads and the coarser occlusion. */
export const AO_BINDINGS = {
  params: 0,
  depth: 1,
  normals: 4,
  setup: 5,
  lower: 6,
} as const

/** The formats of the textures the passes draw: the setup's normal and depth, and the occlusion. */
export const AO_SETUP_FORMAT: GPUTextureFormat = 'rgba16float'
export const AO_OCCLUSION_FORMAT: GPUTextureFormat = 'r8unorm'
