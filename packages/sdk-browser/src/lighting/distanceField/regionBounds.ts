import {
  clipmapExtent,
  clipmapResolution,
  GLOBAL_DISTANCE_FIELD_INFLUENCE_RANGE_IN_VOXELS as INFLUENCE_VOXELS,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION as PAGE,
} from '../../../../sdk-core/src/lighting/globalDistanceField.ts'
import type { GlobalDistanceFieldSettings } from '../../../../sdk-core/src/contracts/globalDistanceFieldOptions.ts'

/**
 * THE BOXES OF THE CLIPMAPS' UPDATES (`updateRegions.ts`), in centimetres: where a clipmap stands
 * for a camera, the slab it uncovers as the camera steps, the regions a placement changed that reach
 * it. A box is its centre and its half-extent on each axis, or six numbers, `min` then `max`.
 */

export type Vec3 = [number, number, number]

/** A region to composite again: its box, and whether the field's influence range grows it. */
export interface UpdateBound {
  readonly center: Vec3
  readonly extent: Vec3
  readonly expand: boolean
}

/** The squared distance between two boxes of six numbers: zero where they touch. */
export function squaredBoxDistance(a: ArrayLike<number>, b: ArrayLike<number>) {
  let sum = 0
  for (let k = 0; k < 3; k++) {
    const apart =
      Math.abs(a[k] + a[3 + k] - b[k] - b[3 + k]) / 2 - (a[3 + k] - a[k] + b[3 + k] - b[k]) / 2
    sum += Math.max(apart, 0) ** 2
  }
  return sum
}

/** The region the camera's step of `move` pages along `axis` uncovered: the slab of that many
 *  pages of the clipmap `min`, `max`, grown by half a page; none for no step. */
export function slabBound(move: Vec3, min: Vec3, max: Vec3, pageSize: number, axis: number) {
  if (move[axis] === 0) return undefined
  const lo = [...min] as Vec3
  const hi = [...max] as Vec3
  if (move[axis] > 0) lo[axis] = Math.max(max[axis] - move[axis] * pageSize, min[axis])
  else hi[axis] = Math.min(min[axis] - move[axis] * pageSize, max[axis])
  return {
    center: lo.map((l, k) => 0.5 * (l + hi[k])) as Vec3,
    extent: lo.map((l, k) => 0.5 * (hi[k] - l) + 0.5 * pageSize) as Vec3,
    expand: false,
  }
}

/** The cube of half-side `extent` about `center` as one region. */
export const wholeBound = (center: Vec3, extent: number): UpdateBound => ({
  center: [...center],
  extent: [extent, extent, extent],
  expand: false,
})

/** The regions of `boxes` (six numbers each) that lie within `influence` of `box`, as update regions
 *  that the influence range grows. */
export function reachingRegions(
  boxes: readonly number[],
  box: ArrayLike<number>,
  influence: number,
) {
  const regions: UpdateBound[] = []
  for (let at = 0; at < boxes.length; at += 6) {
    const modified = boxes.slice(at, at + 6)
    if (squaredBoxDistance(modified, box) >= influence * influence) continue
    regions.push({
      center: [0, 1, 2].map((k) => 0.5 * (modified[k] + modified[3 + k])) as Vec3,
      extent: [0, 1, 2].map((k) => 0.5 * (modified[3 + k] - modified[k])) as Vec3,
      expand: true,
    })
  }
  return regions
}

/** The place of one clipmap for a camera: its centre in pages, its centre and box snapped to a page. */
export interface Placed {
  readonly pages: Vec3
  readonly snapped: Vec3
  readonly min: Vec3
  readonly max: Vec3
  readonly pageSize: number
  readonly influence: number
  readonly extent: number
}

/** The size of a page of clipmap `index`, centimetres. */
export const pageSizeOf = (settings: GlobalDistanceFieldSettings, index: number) =>
  PAGE * ((2 * clipmapExtent(settings, index)) / clipmapResolution(settings))

/** Where clipmap `index` stands when the camera is at `origin`: its centre the nearest whole page. */
export function placeAt(
  settings: GlobalDistanceFieldSettings,
  index: number,
  origin: Vec3,
): Placed {
  const extent = clipmapExtent(settings, index)
  const voxel = (2 * extent) / clipmapResolution(settings)
  const pageSize = PAGE * voxel
  const pages = origin.map((c) => Math.round(c / pageSize)) as Vec3
  const snapped = pages.map((p) => p * pageSize) as Vec3
  return {
    pages,
    snapped,
    min: snapped.map((c) => c - extent) as Vec3,
    max: snapped.map((c) => c + extent) as Vec3,
    pageSize,
    influence: INFLUENCE_VOXELS * voxel,
    extent,
  }
}
