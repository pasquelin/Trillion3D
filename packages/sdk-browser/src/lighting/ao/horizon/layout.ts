import { fieldLayout } from '../../../gpu/core/fieldLayout.ts'
import { AO_BINDINGS, AO_OCCLUSION_FORMAT } from '../layout.ts'

/**
 * THE HORIZON SEARCH'S UNIFORM, one for each pass of an image (`writeHorizonParams`), named `view` in the shaders, in `vec4f`s —
 *  - `lens`: the projection's scale on x and y, and the drawn view's size in pixels;
 *  - `rects`: the size of the pass's drawn rectangle, and of the texture it draws into;
 *  - `input`: the same of the texture the pass reads, the last one's result;
 *  - `search`: the radius in centimetres, the share of the horizon a lower sample leaves, the view's height in pixels over the
 *    tangent of its half field of view (the scale of a radius to pixels) and the falloff factor, `2 / radius²`;
 *  - `angles`: the cosine and the sine of the turn of the directions this image, the phase of the steps' offsets, the
 *    count of directions (a whole number);
 *  - `delta`: the sine and the cosine of the angle between two directions, the temporal filter's blend, whether the
 *    surfaces' vectors of motion are bound (1);
 *  - `fade`: the multiplier and the addend of the distance fade, its end in centimetres, the search's reduction;
 *  - `tail`: half the power, the intensity, and the first and last offset of the spatial filter;
 *  - `history`: the size of the rectangle the history was drawn in;
 *  - `mode`: 1 in the pass that finishes the occlusion where the spatial filter is off (the upsample: it applies the power and the
 *    intensity the filter would have), else 0;
 *  - `right`, `up`, `forward`: the camera's axes in the world, `forward` looking into the scene;
 *  - `depth`, `radius`: the projection's depth terms (`../../../post/taa/depthWgsl.ts`);
 *  - `clip`: this image's clip position to the last image's.
 * Distances are in centimetres, the unit the search works in.
 */
export const HORIZON_PARAMS = fieldLayout('HorizonParams', [
  ['lens', 'vec4f'],
  ['rects', 'vec4f'],
  ['input', 'vec4f'],
  ['search', 'vec4f'],
  ['angles', 'vec4f'],
  ['delta', 'vec4f'],
  ['fade', 'vec4f'],
  ['tail', 'vec4f'],
  ['history', 'vec4f'],
  ['mode', 'vec4f'],
  ['right', 'vec4f'],
  ['up', 'vec4f'],
  ['forward', 'vec4f'],
  ['depth', 'vec4f'],
  ['radius', 'vec4f'],
  ['clip', 'mat4x4f'],
] as const)

/** Bytes of the uniform. */
export const HORIZON_PARAMS_BYTES = HORIZON_PARAMS.words * 4

/** The bindings of every horizon pass's group 0: the uniform, the depth pyramid and the surfaces' normals, as the disc search's
 *  (`../layout.ts`, which the shared reads of the image assume), the texture a pass reads of the one before, the history and the
 *  vectors of motion. */
export const HORIZON_BINDINGS = {
  params: AO_BINDINGS.params,
  depth: AO_BINDINGS.depth,
  normals: AO_BINDINGS.normals,
  input: 5,
  history: 6,
  vectors: 7,
  /** The storage texture the spatial filter's compute pass writes. */
  spatialOut: 8,
} as const

/** The format of every texture the horizon search draws: one byte a pixel, as the occlusion itself. */
export const HORIZON_FORMAT: GPUTextureFormat = AO_OCCLUSION_FORMAT
/** The format of the spatial filter's texture, which a compute pass writes: a float, the one-byte format has no storage form
 *  on every device. */
export const HORIZON_SPATIAL_FORMAT: GPUTextureFormat = 'r32float'
