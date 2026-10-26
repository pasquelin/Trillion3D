import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/**
 * The cut's uniform block, described once.
 *
 * The kernels read the block through a WGSL `struct`, and the host fills it by word: `writeDagUniforms`
 * wrote `target[42]` and `ints[54]` against a struct that named every field. Nothing tied the two
 * together, so a field added to one side and not the other would move every word after it and the
 * kernels would read the wrong numbers — a silent image change, not a type error.
 *
 * So the field table below is the only description of the block. `fieldLayout` makes of it the WGSL
 * struct text (`VIEW_UNIFORM_STRUCT`) and the word offsets the host writes. Adding a field means
 * adding one line here, and both sides follow. Offsets follow WGSL's own layout rules; the `vec3`
 * rule is the one that bites: `cameraWorld` is twelve bytes yet starts on a four-word boundary.
 */
/** The block, in order. `as const` is what makes `FieldName` a union of the field names rather
 *  than `string`: a typo in `viewWord` is then a type error, not a throw mid-frame. */
const VIEW_FIELDS = [
  ['planes', 'array<vec4f,6>'],
  ['view', 'mat4x4f'],
  // The render matrix the image draws with, its jitter included, from the render frame — the eye
  // at zero — to clip space, and the previous image's composed at this image's eye: what the
  // occlusion projects a box with (`shader/occlusionWgsl.ts`).
  ['viewProj', 'mat4x4f'],
  ['prevViewProj', 'mat4x4f'],
  // `pixelScale.y` is the view's pixels per unit at unit depth vertically, the level of detail's
  // scale before the threshold divides it (`shader/error.ts`).
  ['pixelScale', 'vec2f'],
  ['pixelError', 'f32'],
  ['near', 'f32'],
  // Each projection's clip depth along its clip weight, `z = depthMap.x * w + depthMap.y`, and the
  // view's size in pixels then and now.
  ['depthMap', 'vec2f'],
  ['prevDepthMap', 'vec2f'],
  ['viewSize', 'vec2u'],
  ['prevSize', 'vec2u'],
  ['clusterCount', 'u32'],
  ['nodeCount', 'u32'],
  ['worldCount', 'u32'],
  // What the occlusion runs (`OCCLUSION_TWO_PASS`), and the culls the host turned off
  // (`CULL_FRUSTUM_OFF`, `CULL_MIN_LOD_OFF`, `CULL_DRAW_DISTANCE_OFF`, `shader/viewsWgsl.ts`), and
  // that no placement names a draw distance (`CULL_NO_DRAW_DISTANCES`).
  ['occlusion', 'u32'],
  ['cullOff', 'u32'],
  // The list of visible clusters holds `visCap` records (`visible/layout.ts`), and one pass opens
  // `nodeBudget` nodes at most (`shader/listsWgsl.ts`, `../flagSections.ts`): in the words
  // `cameraWorld`'s alignment leaves.
  ['visCap', 'u32'],
  ['nodeBudget', 'u32'],
  // The placement tree's members drawn whatever the view (`placement/placementTree.ts`, `drawnAlways`): how
  // many its list holds (`tree/treeTable.ts`); in the word `cameraWorld`'s alignment leaves.
  ['alwaysCount', 'u32'],
  ['cameraWorld', 'vec3f'],
  ['listCap', 'u32'],
  ['perspective', 'f32'],
  ['queueCap', 'u32'],
  ['treeTop', 'u32'],
  ['cellBase', 'u32'],
  ['worldLinks', 'u32'],
  // The open counts placements hold of their own (`heldOpen.ts`): the first word of their table in
  // `out.pages`, and its slots less one.
  ['heldBase', 'u32'],
  ['heldMask', 'u32'],
  // The candidates hold `candCap` entries (`shader/listsWgsl.ts`, `../flagSections.ts`).
  ['candCap', 'u32'],
  // The scale every draw distance of an instance is multiplied by, and the one an object of its own's
  // is, the field of view's scale included (`shader/drawDistanceWgsl.ts`).
  ['viewDistanceScale', 'f32'],
  ['primitiveDistanceScale', 'f32'],
  // The eye the cut reads its translations at, `cameraWorld` in doubles, high word then low word
  // (`shader/worldPoseWgsl.ts`): x and y in the first, z in the second.
  ['eye', 'array<vec4u,2>'],
  // The view's clip plane in the render frame, `dot(xyz, p) + w` at least 0 drawn, all zero for none
  // (`shader/clipPlaneWgsl.ts`), and the word of `work` its filter's bits start at — a bit a
  // placement, set when the view does not draw it —, 0 for a view with no filter
  // (`shader/viewFilterWgsl.ts`).
  ['clipPlane', 'vec4f'],
  ['filterBase', 'u32'],
  // What the cluster cull judges the rasters by (`shader/visibleWgsl.ts`): the software raster on
  // (1) or off (0), the view's pixels per unit at depth one over the threshold of
  // `hardwareRasterEdgePixels`, whether the frame tessellates the surfaces that name a
  // displacement, and the span the depth buckets are spread over (`depthBuckets` 0 for none).
  ['hardwareEdge', 'f32'],
  ['softwareRaster', 'u32'],
  ['tessellation', 'u32'],
  ['depthBuckets', 'u32'],
  ['bucketMinZ', 'f32'],
  ['bucketMaxZ', 'f32'],
] as const

const LAYOUT = fieldLayout('Uniforms', VIEW_FIELDS)

/** Words the block holds: the size the host allocates. */
export const VIEW_BLOCK_WORDS = LAYOUT.words

/** The word a field starts at. `viewWord('occlusion')` is where the host writes what the kernels
 *  read as `cutView.occlusion`; nothing else may hold that number. */
export const viewWord = (field: FieldName): number => {
  const at: number | undefined = LAYOUT.at[field]
  if (at === undefined) throw new Error(`${field} is not a field of the cut's uniform block`)
  return at
}

/** The name of a field of the block, as the union the compiler and the host are checked against. */
export type FieldName = (typeof VIEW_FIELDS)[number][0]

/** The WGSL struct the kernels bind, built from the same table the host writes against. */
export const VIEW_UNIFORM_STRUCT = LAYOUT.wgsl
