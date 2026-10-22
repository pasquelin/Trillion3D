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
/** Voxels either side of a surface a clipmap stores. */
export const GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS = 4
/** The page atlas's pages along its first two axes. */
export const GLOBAL_DISTANCE_FIELD_ATLAS_PAGES = 128
/** Pages along an axis of a cell of the culling grid. */
export const GLOBAL_DISTANCE_FIELD_CULL_GRID_FACTOR = 4
/** Voxels a page is grown by all round when it asks whether a mesh reaches it. */
export const GLOBAL_DISTANCE_FIELD_PAGE_BORDER = 0.5
/** The groups of 4 × 4 × 4 voxels a page of 8 × 8 × 8 is composited by. */
export const GLOBAL_DISTANCE_FIELD_PAGE_GROUP_NUM = 8
/** What a page table holds where no page is allocated. */
export const GLOBAL_DISTANCE_FIELD_INVALID_PAGE = 0xffffffff
/** The page atlas's pages along its first axis, as a shift and a mask of a page's index. */
export const GLOBAL_DISTANCE_FIELD_ATLAS_PAGES_SHIFT = 7
/** The passes the coarse mip is propagated in. */
export const GLOBAL_DISTANCE_FIELD_MIP_PROPAGATION_STEPS = 5
/** The most a camera's velocity offset drifts from a clipmap's centre, as a share of its extent. */
export const GLOBAL_DISTANCE_FIELD_MAX_CAMERA_DRIFT = 0.75

type Vec3 = readonly [number, number, number]

/** The clipmaps a view holds: the setting, one more in the fast camera mode, held between 0 and 6. */
export const numClipmaps = (settings: GlobalDistanceFieldSettings) =>
  clamp(
    settings.globalDistanceFieldClipmaps + (settings.globalDistanceFieldFastCameraMode ? 1 : 0),
    0,
    GLOBAL_DISTANCE_FIELD_MAX_CLIPMAPS,
  )

/** The clipmaps updated each frame: one in the fast camera mode, else the setting. */
export const clipmapUpdatesPerFrame = (settings: GlobalDistanceFieldSettings) =>
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
export function updateFrequency(
  settings: GlobalDistanceFieldSettings,
  index: number,
  count: number,
) {
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

/** A clipmap placed around a view origin. */
export interface Clipmap {
  readonly extent: number
  readonly voxelSize: number
  readonly pageSize: number
  /** Half the range either side of a surface a page stores: four voxels. */
  readonly influenceRadius: number
  /** The centre, snapped to a whole page of the view origin. */
  readonly center: Vec3
  /** The page the centre lies at. */
  readonly centerInPages: Vec3
}

/** Clipmap `index` around `origin`: its centre the origin snapped to the nearest whole page. */
export function placeClipmap(
  settings: GlobalDistanceFieldSettings,
  index: number,
  origin: Vec3,
): Clipmap {
  const extent = clipmapExtent(settings, index)
  const voxelSize = (2 * extent) / clipmapResolution(settings)
  const pageSize = GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION * voxelSize
  const centerInPages = origin.map((c) => Math.round(c / pageSize)) as unknown as Vec3
  return {
    extent,
    voxelSize,
    pageSize,
    influenceRadius: GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS * voxelSize,
    center: centerInPages.map((p) => p * pageSize) as unknown as Vec3,
    centerInPages,
  }
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

/** The page grid coordinate of a page tile, packed in a word for the passes' lists: 8 bits an axis. */
export const packPageTile = (x: number, y: number, z: number) => x | (y << 8) | (z << 16)

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
