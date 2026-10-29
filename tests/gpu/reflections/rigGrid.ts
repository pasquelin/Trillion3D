// The object grid of the reflection rig's clipmap (`rigCache.ts`): for each cell of each page of the field, the faces near it, nearest first, packed as the engine's grid pass does.
import {
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CARD_INTERPOLATION_RANGE_IN_VOXELS as RANGE_VOXELS,
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_CELL_SIZE as NAMED,
  GLOBAL_DISTANCE_FIELD_OBJECT_GRID_PAGE_RESOLUTION as CELLS,
  GLOBAL_DISTANCE_FIELD_PAGE_RESOLUTION as PAGE_VOXELS,
} from '../../../packages/sdk-core/src/lighting/globalDistanceField.ts'
import { CENTIMETRES, meshesOf, triangleDistance, type RigClipmap } from './rigField.ts'
import type { RigFace } from './rigRuntime.ts'
import type { Vec3 } from '../../../packages/math/src/vector/vectorTuple.ts'

/** The offset of the cell `(x, y, z)` of a page of the grid (`gdfGridCellOffset`). */
const cellOffset = (x: number, y: number, z: number) =>
  (x & 1) +
  2 * (y & 1) +
  4 * (z & 1) +
  8 * ((x >> 1) & 1) +
  16 * ((y >> 1) & 1) +
  32 * ((z >> 1) & 1)

/** The object grid of the rig's clipmap over `faces`: for each cell of each page, the `NAMED` faces nearest to it within its reach, packed as the
 *  grid's pass does (`objectGridWgsl.ts`): the cell's centre is at voxel `page · 7 + 2 · cell` of the clipmap, a voxel being `2 · extent / (7 · pages)` and
 *  the bias of the voxels' centres half of it, the cell's extent `7 / 4` half voxels and its reach 1.44 of it with the cards' range, in half voxels. */
export function objectGrid({ centre, extent, pages }: RigClipmap, faces: readonly RigFace[]) {
  const voxel = (2 * extent) / (PAGE_VOXELS * pages)
  const half = voxel / 2
  const cellExtent = (half * PAGE_VOXELS) / CELLS
  const reach = 1.44 * cellExtent + RANGE_VOXELS * half
  const stride = CELLS ** 3
  const grid = new Uint32Array(pages ** 3 * stride * 4).fill(0xffffffff)
  const meshes = meshesOf(faces).map((triangles) => {
    const low = [Infinity, Infinity, Infinity],
      high = [-Infinity, -Infinity, -Infinity]
    for (const point of triangles.flat())
      point.forEach((c, a) => {
        low[a] = Math.min(low[a], c * CENTIMETRES)
        high[a] = Math.max(high[a], c * CENTIMETRES)
      })
    return { low, high, triangles }
  })
  const world = (page: number, cell: number, axis: number) =>
    centre[axis] - extent + (page * PAGE_VOXELS + 2 * cell) * voxel + half
  const p: Vec3 = [0, 0, 0]
  const metres: Vec3 = [0, 0, 0]
  for (let pz = 0; pz < pages; pz++)
    for (let py = 0; py < pages; py++)
      for (let px = 0; px < pages; px++)
        for (let z = 0; z < CELLS; z++)
          for (let y = 0; y < CELLS; y++)
            for (let x = 0; x < CELLS; x++) {
              p[0] = world(px, x, 0)
              p[1] = world(py, y, 1)
              p[2] = world(pz, z, 2)
              for (let a = 0; a < 3; a++) metres[a] = p[a] / CENTIMETRES
              const named: number[] = []
              meshes.forEach(({ low, high, triangles }, instance) => {
                // The box of the face first: a face farther than the reach is not named.
                let apart = 0
                for (let a = 0; a < 3; a++) {
                  const outside = Math.max(low[a] - p[a], p[a] - high[a], 0)
                  apart += outside * outside
                }
                if (apart >= reach * reach) return
                let distance = Infinity
                for (const [a, b, c] of triangles)
                  distance = Math.min(distance, CENTIMETRES * triangleDistance(metres, a, b, c))
                if (!(distance < reach)) return
                const unit = Math.min(
                  Math.max((distance + 0.25 * cellExtent) / (reach + 0.25 * cellExtent), 0),
                  1,
                )
                named.push(
                  ((instance & 0xffffff) | (Math.min(Math.floor(unit * 256), 255) << 24)) >>> 0,
                )
              })
              named.sort((a, b) => a - b)
              const page = (pz * pages + py) * pages + px
              const at = (page * stride + cellOffset(x, y, z)) * 4
              for (let k = 0; k < Math.min(named.length, NAMED); k++) grid[at + k] = named[k]
            }
  return grid
}
