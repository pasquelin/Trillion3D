import { fieldLayout, vec4Array } from '../../../gpu/core/fieldLayout.ts'
import { CONE_DIRECTIONS } from './cones.ts'

/**
 * THE DISTANCE-FIELD OCCLUSION'S UNIFORM, one for the view, read by every pass (`dfaoParams`, `params.ts`). Lengths
 * are centimetres, the unit of the fields; a matrix takes a position in centimetres.
 *  - `unprojectToWorld` takes a device position (and a device depth) to the world, `previousUnproject` the
 *    previous image's, `viewProjection` a world position to the clip space, `clipToPreviousClip` this image's clip
 *    position to its place in the previous one; `worldToView` and `viewToWorld` turn a point between the world and
 *    the eye's frame — x to the right, y up, z forward — (the eye is the last column of the second, the view's forward
 *    its third);
 *  - `planes`: the view frustum's, `dot(xyz, p) - w` positive outside;
 *  - `directions`: the cones' directions in the surface's tangent space (`cones.ts`);
 *  - `grid`: the normals and depths grid's size, the view's size in pixels; `cones`: the cone grid's size, the tiles
 *    along each side; `counts`: the frustum's planes, the meshes in the scene, the indices of the bounding
 *    sphere, the flags (`DFAO_FLAG`);
 *  - `distances`: the meshes' occlusion distance, the first step's scale, the exponent that spaces the steps, the
 *    farthest a pixel is lit by it; `global`: the global field's occlusion distance, the tangent of the cones'
 *    half angle, the factor that normalises a bent normal, the scale of the fade past the farthest pixel;
 *  - `jitter`: the cone grid's jitter in pixels of the grid, the conservative radius scale of the bounding sphere;
 *  - `history`: the share of the last image kept, the distance past which it is another surface's, whether a
 *    stability pass follows; `historyScale` and `historyUv`: how a screen position falls in the history and its
 *    texture coordinates' least and largest; `uvMax`: the largest coordinate a bilateral read takes, and the
 *    largest the stability pass takes;
 *  - `lens`: the projection's scale on x and y and the near plane; `depth`: how a device depth turns into a
 *    distance (`depthTerms`).
 */
export const DFAO_PARAMS = fieldLayout('DfaoParams', [
  ['unprojectToWorld', 'mat4x4f'],
  ['viewProjection', 'mat4x4f'],
  ['previousUnproject', 'mat4x4f'],
  ['clipToPreviousClip', 'mat4x4f'],
  ['worldToView', 'mat4x4f'],
  ['viewToWorld', 'mat4x4f'],
  ['planes', 'array<vec4f,6>'],
  ['directions', vec4Array(CONE_DIRECTIONS)],
  ['grid', 'vec4u'],
  ['cones', 'vec4u'],
  ['counts', 'vec4u'],
  ['distances', 'vec4f'],
  ['global', 'vec4f'],
  ['jitter', 'vec4f'],
  ['history', 'vec4f'],
  ['historyScale', 'vec4f'],
  ['historyUv', 'vec4f'],
  ['uvMax', 'vec4f'],
  ['lens', 'vec4f'],
  ['depth', 'vec4f'],
] as const)

/** Bytes of the uniform. */
export const DFAO_PARAMS_BYTES = DFAO_PARAMS.words * 4

/** The bits of `counts.w`. */
export const DFAO_FLAG = {
  /** The vectors of the surfaces' motion are there to read. */
  velocity: 1,
  /** The view is smaller than the grid: a stability read is held to the view's texels. */
  clampView: 2,
} as const

/** The formats of the textures: the normals and depths, the bent normals (at the cones' size and at the grid's). */
export const DFAO_NORMAL_FORMAT: GPUTextureFormat = 'rgba16float'
export const DFAO_BENT_FORMAT: GPUTextureFormat = 'rgba16float'
/** The format of the stand-in target of the scatter's draw: the passes write no colour to it. */
export const DFAO_STAND_IN_FORMAT: GPUTextureFormat = 'rgba8unorm'

/**
 * The bindings, one table for every pass, so a resource has one number: a pass binds the ones it names
 * (`DFAO_PROGRAM_BINDINGS`). The depth pyramid takes three, from `depth`; the global field's reads four, from
 * `field` (`globalDistanceFieldReadWgsl`); the meshes' fields seven, from `objects` (`meshFieldWgsl`).
 */
export const DFAO_BINDING = {
  params: 0,
  depth: 1,
  surfaceNormals: 4,
  vectors: 5,
  /** The normals and depths of the grid (`rgba16float`: world normal, scene depth). */
  normals: 6,
  /** Nine visibilities a cone-grid cell, the bits of a float (`atomicMin`), initialised to one. */
  visibility: 7,
  /** The bent normals at the cones' size, and at the grid's: the new history and the history. */
  bent: 8,
  history: 9,
  output: 10,
  sampler: 11,
  /** The meshes culled to the view, the draw's arguments, and the tile lists. */
  culledObjects: 12,
  objectArgs: 13,
  tileAxis: 14,
  tileRanges: 15,
  tileCounts: 16,
  tileOffsets: 17,
  tileData: 18,
  tileArgs: 19,
  field: 20,
  objects: 24,
} as const
