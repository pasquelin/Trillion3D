import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import type { GlobalDistanceFieldSettings } from '../contracts/globalDistanceFieldOptions.ts'

/**
 * THE GLOBAL DISTANCE FIELD'S CLIPMAPS: where each of them lies around the viewer, how large its
 * voxels and its pages are, which of them update on a frame, and the numbers a program reads to
 * find a position in them (`packages/sdk-browser/src/lighting/distanceField/globalReadWgsl.ts`).
 *
 * The meshes' distance fields (`./distanceFieldFile.ts`) are composited into nested clipmaps, each
 * a cube of `resolution` voxels held in pages of 7 voxels (8 in the page atlas, the eighth the
 * trilinear filter's), snapped to whole pages as the viewer moves. A page holds the distance of
 * its voxels to the nearest surface within the clipmap's influence range, 4 voxels either side,
 * one byte each; a page no surface reaches is not allocated. Every length is in the reference's
 * unit, the centimetre.
 */

/** The most clipmaps a view holds. */
export const GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS = 6
/** Voxels a page holds along an axis, and the same in the atlas with the filter's margin. */
export const GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION = 7
export const GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS = 8
/** The coverage atlas's voxels along an axis of a page, with the trilinear filter's margin and without it, and
 *  how many of the page's voxels apart they lie (the voxels of every second texel). */
export const GLOBAL_DISTANCE_FIELD_COVERAGE_PAGE_RESOLUTION_IN_ATLAS = 4
export const GLOBAL_DISTANCE_FIELD_COVERAGE_PAGE_RESOLUTION = 3
export const GLOBAL_DISTANCE_FIELD_COVERAGE_DOWNSAMPLE_FACTOR =
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION_IN_ATLAS /
  GLOBAL_DISTANCE_FIELD_COVERAGE_PAGE_RESOLUTION_IN_ATLAS
/** The object grid beside the pages: the cells along an axis of a page, the objects a cell holds (a word
 *  each: the object's row in 24 bits, its distance in 8), and the number of voxel extents (half a voxel each)
 *  around a cell that its objects' cards reach. */
export const GLOBAL_DISTANCE_FIELD_OBJECT_GRID_PAGE_RESOLUTION = 4
export const GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CELL_SIZE = 4
export const GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CARD_INTERPOLATION_RANGE_IN_VOXELS = 3
/** The bytes the object grid keeps for a page: its cells, 4 words each. */
export const GLOBAL_DISTANCE_FIELD_OBJECT_GRID_PAGE_BYTES =
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_PAGE_RESOLUTION ** 3 *
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CELL_SIZE *
  4
/** Voxels either side of a surface a clipmap stores. */
export const GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS = 4
/** The most steps a ray marched through the field takes in one clipmap. */
export const GLOBAL_DISTANCE_FIELD_TRACE_MAX_STEPS = 256
/** The page atlas's pages along its first two axes. */
const GLOBAL_DISTANCE_FIELD_ATLAS_PAGES = 128
/** Pages along an axis of a cell of the culling grid. */
export const GLOBAL_DISTANCE_FIELD_CULL_GRID_FACTOR = 4
/** The groups of 4 × 4 × 4 voxels a page of 8 × 8 × 8 is composited by. */
export const GLOBAL_DISTANCE_FIELD_PAGE_GROUP_NUM = 8
/** The passes the coarse mip is propagated in. */
export const GLOBAL_DISTANCE_FIELD_MIP_PROPAGATION_STEPS = 5
/** The most a camera's velocity offset drifts from a clipmap's centre, as a share of its extent. */
const GLOBAL_DISTANCE_FIELD_MAX_CAMERA_DRIFT = 0.75

type Vec3 = readonly [number, number, number]

/** The clipmaps a view holds: the setting, one more in the fast camera mode, held between 0 and 6. */
export const numClipmaps = (settings: GlobalDistanceFieldSettings) =>
  clamp(
    settings.globalDistanceFieldClipmaps + (settings.globalDistanceFieldFastCameraMode ? 1 : 0),
    0,
    GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS,
  )

/** The factor between one clipmap's extent and the next while rays are marched through the field. */
const TRACE_CLIPMAP_EXPONENT = 2

/**
 * Sizes `settings` for the rays marched through the field, in place: the voxels along a clipmap are
 * `globalDistanceFieldTraceResolution`, the first clipmap's half-extent is
 * `globalDistanceFieldTraceClipmapExtent` and each next one's twice the one before — the three
 * settings the sizes below read (`globalDistanceFieldResolution`, `globalDistanceFieldViewDistance`,
 * `globalDistanceFieldClipmapExponent`) written —, and the clipmaps are those the setting names and
 * one more where the extent of the clipmap after them reaches `globalDistanceFieldTraceViewDistance`,
 * two more where the extent of the second after them does (`globalDistanceFieldClipmaps` written),
 * as the frame resolves them again from the options each image. A field a ray is not marched
 * through keeps the sizes the options give.
 */
export function sizeForTraces(settings: GlobalDistanceFieldSettings) {
  const wanted = settings.globalDistanceFieldClipmaps
  const first = settings.globalDistanceFieldTraceClipmapExtent
  const reach = settings.globalDistanceFieldTraceViewDistance
  settings.globalDistanceFieldResolution = settings.globalDistanceFieldTraceResolution
  settings.globalDistanceFieldClipmapExponent = TRACE_CLIPMAP_EXPONENT
  settings.globalDistanceFieldViewDistance = first * TRACE_CLIPMAP_EXPONENT ** 3
  settings.globalDistanceFieldClipmaps =
    wanted +
    (first * TRACE_CLIPMAP_EXPONENT ** (wanted + 1) <= reach
      ? 2
      : first * TRACE_CLIPMAP_EXPONENT ** wanted <= reach
        ? 1
        : 0)
}

/** The clipmaps updated each frame: one in the fast camera mode, else the setting. */
const clipmapUpdatesPerFrame = (settings: GlobalDistanceFieldSettings) =>
  settings.globalDistanceFieldFastCameraMode ? 1 : settings.globalDistanceFieldUpdatesPerFrame

/** The voxels along a clipmap: the setting rounded up to a whole number of groups of 4 pages. */
export const clipmapResolution = (settings: GlobalDistanceFieldSettings) =>
  ceilDiv(settings.globalDistanceFieldResolution, 4 * GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION) *
  4 *
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION

/** The voxels along a clipmap's coarse mip. */
export const clipmapMipResolution = (settings: GlobalDistanceFieldSettings) =>
  ceilDiv(clipmapResolution(settings), settings.globalDistanceFieldMipFactor)

/** Pages along a clipmap. */
export const pageTableClipmapResolution = (settings: GlobalDistanceFieldSettings) =>
  ceilDiv(clipmapResolution(settings), GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION)

/** Half the side of clipmap `index`: the view distance over the exponent cubed for the first, times
 *  the exponent for each next. */
export const clipmapExtent = (settings: GlobalDistanceFieldSettings, index: number) =>
  (settings.globalDistanceFieldViewDistance / settings.globalDistanceFieldClipmapExponent ** 3) *
  settings.globalDistanceFieldClipmapExponent ** index

/** The pages of the atlas along each axis: 128 × 128 and as many layers as the page tables, with
 *  the share the occupancy ratio expects filled (twice the pages when the static meshes have a
 *  clipmap of their own), need. */
export function pageAtlasSizeInPages(settings: GlobalDistanceFieldSettings, clipmaps: number) {
  const table = pageTableClipmapResolution(settings)
  const needed = Math.ceil(
    table *
      table *
      table *
      clipmaps *
      (settings.globalDistanceFieldCacheMostlyStaticSeparately ? 2 : 1) *
      clamp(settings.globalDistanceFieldOccupancyRatio, 0.1, 1),
  )
  const layers = ceilDiv(needed, GLOBAL_DISTANCE_FIELD_ATLAS_PAGES ** 2)
  return [GLOBAL_DISTANCE_FIELD_ATLAS_PAGES, GLOBAL_DISTANCE_FIELD_ATLAS_PAGES, layers] as const
}

/** How often, and from which frame, clipmap `index` of `count` updates: the first ones every frame,
 *  each next at half the frequency of the one before, a different phase for each so that only one
 *  of them lands on a frame, the last at the frequency of the one before it. */
function updateFrequency(settings: GlobalDistanceFieldSettings, index: number, count: number) {
  const perFrame = settings.globalDistanceFieldStaggeredUpdates
    ? Math.min(clipmapUpdatesPerFrame(settings), count)
    : count
  if (index < perFrame - 1) return { frequency: 1, phase: 0 }
  const rest = index - (perFrame - 1)
  const frequency = index === count - 1 ? 1 << rest : 2 << rest
  return { frequency, phase: (1 << rest) - 1 }
}

/** Whether clipmap `index` updates on frame `updateIndex`. */
export const updatesThisFrame = (
  settings: GlobalDistanceFieldSettings,
  index: number,
  count: number,
  updateIndex: number,
) => {
  const { frequency, phase } = updateFrequency(settings, index, count)
  return updateIndex % frequency === phase
}

/** The smallest bounding radius a mesh needs to be composited into a clipmap of voxels
 *  `voxelSize` wide; the fast camera mode asks ten times the radius and five times the voxels. */
export const minMeshRadius = (settings: GlobalDistanceFieldSettings, voxelSize: number) => {
  const fast = settings.globalDistanceFieldFastCameraMode
  return Math.max(
    settings.globalDistanceFieldMinMeshRadius * (fast ? 10 : 1),
    settings.globalDistanceFieldMinMeshRadiusInVoxels * voxelSize * (fast ? 5 : 1),
  )
}

/** The camera's offset of a clipmap held within `MAX_CAMERA_DRIFT` of its extent, each axis. */
export function clampCameraOffset(
  offset: Vec3,
  settings: GlobalDistanceFieldSettings,
  clipmap: number,
): Vec3 {
  const limit = clipmapExtent(settings, clipmap) * GLOBAL_DISTANCE_FIELD_MAX_CAMERA_DRIFT
  return offset.map((c) => clamp(c, -limit, limit)) as unknown as Vec3
}

/** The half angle of the occlusion cones: nine of them each covering an equal solid angle. */
export const OCCLUSION_CONE_HALF_ANGLE = Math.acos(1 - 1 / 9)

/**
 * The occlusion distances the sky light asks for, split between the meshes' own fields and the
 * global one: the distance held to 2 .. 3000, and the global field's from `startDistance` on — the
 * meshes' own up to it. With no global field the meshes' own are all of it.
 */
export function occlusionDistances(
  settings: GlobalDistanceFieldSettings,
  occlusionMaxDistance: number,
) {
  const distance = clamp(occlusionMaxDistance, 2, 3000)
  if (!settings.globalDistanceField) return { object: distance, global: 0 }
  const start = settings.globalDistanceFieldStartDistance
  return { object: Math.min(distance, start), global: distance >= start ? distance : 0 }
}
