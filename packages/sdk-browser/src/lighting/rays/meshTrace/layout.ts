import { fieldLayout, vec4Array } from '../../../gpu/core/fieldLayout.ts'

/**
 * THE MESHES' FIELDS TRACE'S UNIFORM, one for the view, read by the culling passes and by the rays that trace the meshes
 * a cell of the view's grid lists (`meshGridParams.ts` writes it). Lengths are centimetres, the unit of the fields; the
 * matrices take positions in centimetres, and the eye's frame has x right, y up, z forward.
 *  - `worldToView`, `viewProjection`, `unprojectToWorld`: a world position to the eye's frame, to the clip space, and a
 *    device position (with its depth) to the world; `planes`: the view frustum's, `dot(xyz, p) - w` positive outside;
 *  - `lens`: the projection's scale on x, its offset on x by the depth, its scale on y and its offset on y by the depth,
 *    as the eye's frame applies them (`clip.x = lens.x * x + lens.y * z`); `view`: the view's size in pixels and its
 *    inverse; `eye`: the camera's place; `depth`: how a device depth turns into a distance (near, 0, 1 for a
 *    perspective; range, near, 0 for an orthographic one);
 *  - `zParams`: the grid's depth law (scale, offset, slices a doubling), a depth's slice being
 *    `log2(depth * scale + offset) * slices`; `distances`: the farthest from the camera a mesh is traced at, how far a
 *    mesh's field is reached past its bounds, the radius under which a mesh is left out, the factor that puts the edges of
 *    the coarse bounding sphere on the true one;
 *  - `trace`: for the mesh that is mostly two-sided, the scale of the surface's expansion, of the least step, and the
 *    noise under which a dithered ray is stopped at each step;
 *  - `counts`: the frustum's planes, the meshes in the scene, the index count of the bounding sphere, the flags
 *    (`MESH_GRID_FLAG`); `grid`: the cells along x, y and the depth slices, and the base 2 logarithm of a cell's pixels;
 *    `limits`: the entries the scatter has room for, the grid's cells, the level of the depth pyramid the cells read, the
 *    image's rank among 8 (the dither's).
 */
export const MESH_GRID_PARAMS = fieldLayout('MeshGridParams', [
  ['worldToView', 'mat4x4f'],
  ['viewProjection', 'mat4x4f'],
  ['unprojectToWorld', 'mat4x4f'],
  ['planes', vec4Array(6)],
  ['lens', 'vec4f'],
  ['view', 'vec4f'],
  ['eye', 'vec4f'],
  ['depth', 'vec4f'],
  ['zParams', 'vec4f'],
  ['distances', 'vec4f'],
  ['trace', 'vec4f'],
  ['counts', 'vec4u'],
  ['grid', 'vec4u'],
  ['limits', 'vec4u'],
] as const)

/** Bytes of the uniform. */
export const MESH_GRID_PARAMS_BYTES = MESH_GRID_PARAMS.words * 4

/** The bits of `counts.w`. */
export const MESH_GRID_FLAG = {
  /** The grid has more than one depth slice: a mesh is listed in the slices the depth bounds leave it. */
  slices: 1,
} as const

/** The threads of a group of the culling to the view, of the start offsets and of the compaction. */
export const MESH_GRID_GROUP = 64

/** The words an entry of the scatter's list holds: the mesh and the cell it reaches. */
export const SCATTER_ENTRY_WORDS = 2
/** The words a cell of the grid holds: the meshes it lists, then where its run starts in the list. */
export const CELL_WORDS = 2

/** The format of the stand-in target of the scatter's draw: the passes write no colour to it. */
export const MESH_GRID_STAND_IN_FORMAT: GPUTextureFormat = 'rgba8unorm'

/**
 * The bindings, one table for every pass, so a resource has one number. The depth pyramid takes three, from `depth`
 * (`hizDepthWgsl`); the meshes' fields seven, from `objects` (`meshFieldWgsl`). A ray that traces the meshes binds
 * `params`, `cells` and `indices` beside the fields (`meshTraceWgsl`), at the offsets its program gives.
 */
export const MESH_GRID_BINDING = {
  params: 0,
  depth: 1,
  objects: 4,
  /** The meshes culled to the view, and the draw's arguments (index count, meshes listed, zeros). */
  culledObjects: 11,
  objectArgs: 12,
  /** The entries the scatter lists before they are compacted: their count, then the mesh and cell of each. */
  scatterCount: 13,
  scatterEntries: 14,
  /** A cell's count and start (`CELL_WORDS`), the compacted lists, the compaction's dispatch, the allocator. */
  cells: 15,
  indices: 16,
  compactArgs: 17,
  allocator: 18,
} as const
