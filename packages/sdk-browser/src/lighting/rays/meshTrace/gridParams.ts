import { clamp } from '../../../../../math/src/scalar/reals.ts'
import { invertMatrix4 } from '../../../../../math/src/matrix/matrix4Inverse.ts'
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { MeshDistanceFieldTraceSettings } from '../../../../../sdk-core/src/contracts/meshDistanceFieldTraceOptions.ts'
import { CENTIMETRES_PER_METRE } from '../../../../../sdk-core/src/page/format.ts'
import { putVec4 } from '../../../gpu/core/fieldLayout.ts'
import { BOUNDING_SPHERE_RINGS } from '../../distanceField/ao/cones.ts'
import {
  putPlanes,
  putScaledColumns,
  putScaledRows,
  putWorldToView,
} from '../../distanceField/viewParams.ts'
import { MESH_GRID_FLAG, MESH_GRID_PARAMS } from './layout.ts'

const CM = CENTIMETRES_PER_METRE

/** What an image tells the trace of the camera, in metres: the view-projection (world to clip, column-major), the camera's
 *  world matrix and projection, the depth range, whether the projection is a perspective, the size drawn and the scene buffers'
 *  size, and the image's number (the dither's rank among 8). */
export interface MeshGridImage {
  view: readonly [number, number]
  extent: readonly [number, number]
  viewProjection: ArrayLike<number>
  world: ArrayLike<number>
  projection: ArrayLike<number>
  near: number
  far: number
  perspective: boolean
  frame: number
}

/** The grid of the view's cells: the cells along x, y and the depth, the base 2 logarithm of a cell's pixels and the depth law
 *  (scale, offset, slices a doubling) the slices follow. */
export interface MeshGridShape {
  cells: readonly [number, number, number]
  pixelShift: number
  law: readonly [number, number, number]
}

/**
 * The grid of a view of `size` pixels whose camera's near plane is `near` centimetres, over the distance `endDistance`:
 * the cells are `settings.cullGridPixelSize` pixels along each side, and the slices of depth number the doublings of the
 * span between the near plane and the end distance (read through the log law's scale) plus one, the law being the settings'.
 */
export function meshGridShape(
  size: readonly [number, number],
  near: number,
  endDistance: number,
  settings: MeshDistanceFieldTraceSettings,
): MeshGridShape {
  const nearest = Math.min(endDistance, near)
  const farthest = Math.max(endDistance, near)
  const slices =
    Math.max(
      Math.trunc(
        Math.log2((farthest - nearest) * settings.cullGridLogZScale) * settings.cullGridZScale,
      ),
      0,
    ) + 1
  const pixels = settings.cullGridPixelSize
  return {
    cells: [ceilDiv(size[0], pixels), ceilDiv(size[1], pixels), slices],
    pixelShift: Math.log2(pixels),
    law: [settings.cullGridLogZScale, settings.cullGridLogZOffset, settings.cullGridZScale],
  }
}

/** The cells of a grid. */
export const gridCellCount = (cells: readonly [number, number, number]) =>
  cells[0] * cells[1] * cells[2]

/** The entries the scatter has room for in a grid of `cells` cells: the cells times the meshes a cell is expected to hold, held to
 *  what a storage binding of the device takes (an entry is two words). */
export const gridEntryCapacity = (
  cells: number,
  settings: MeshDistanceFieldTraceSettings,
  maxBindingBytes: number,
) => Math.min(cells * settings.averageCulledCount, Math.floor(maxBindingBytes / 8))

const inverse = new Float64Array(16)
const current = new Float64Array(16)
const clipScaled = new Float32Array(16)

/** What the passes are told of the scene and the settings. */
export interface MeshGridScene {
  /** The meshes in the scene, and the index count of the bounding sphere's draw. */
  objects: number
  sphereIndices: number
  /** The farthest from the camera a mesh is traced at, and how far a mesh's field is reached past its bounds, in centimetres. */
  endDistance: number
  traceDistance: number
  /** The view's scene detail, which the radius threshold is divided by (1 for the default). */
  sceneDetail: number
  /** The entries the scatter has room for. */
  entries: number
}

/**
 * Writes the uniform of the view's trace (`MESH_GRID_PARAMS`) into `floats` and `words`, two views of the same buffer:
 * the matrices of the image in centimetres, the projection as the eye's frame applies it, the grid's shape and law, the
 * distances and the settings of the trace.
 */
export function writeMeshGridParams(
  floats: Float32Array,
  words: Uint32Array,
  input: {
    image: MeshGridImage
    shape: MeshGridShape
    scene: MeshGridScene
    settings: MeshDistanceFieldTraceSettings
  },
) {
  const { image, shape, scene, settings } = input
  const at = MESH_GRID_PARAMS.at
  putWorldToView(floats, at.worldToView, image.world)
  putScaledColumns(floats, at.viewProjection, image.viewProjection, 1 / CM)
  current.set(image.viewProjection)
  invertMatrix4(inverse, current)
  putScaledRows(floats, at.unprojectToWorld, inverse, CM)
  putScaledColumns(clipScaled, 0, image.viewProjection, 1 / CM)
  words[at.counts] = putPlanes(floats, at.planes, clipScaled)
  const m = image.projection
  putVec4(floats, at.lens, m[0], -m[8], m[5], -m[9])
  putVec4(floats, at.view, image.view[0], image.view[1], 1 / image.view[0], 1 / image.view[1])
  putVec4(floats, at.eye, image.world[12] * CM, image.world[13] * CM, image.world[14] * CM, 0)
  if (image.perspective) putVec4(floats, at.depth, image.near, 0, 1, 0)
  else putVec4(floats, at.depth, image.far - image.near, image.near, 0, 0)
  putVec4(floats, at.zParams, shape.law[0], shape.law[1], shape.law[2], 0)
  putVec4(
    floats,
    at.distances,
    scene.endDistance,
    scene.traceDistance,
    settings.radiusThreshold / clamp(scene.sceneDetail, 0.01, 100),
    1 / Math.cos(Math.PI / BOUNDING_SPHERE_RINGS),
  )
  putVec4(
    floats,
    at.trace,
    settings.notCoveredExpandSurfaceScale,
    settings.notCoveredMinStepScale,
    settings.ditheredTransparencyStepThreshold,
    0,
  )
  words[at.counts + 1] = scene.objects
  words[at.counts + 2] = scene.sphereIndices
  words[at.counts + 3] = shape.cells[2] > 1 ? MESH_GRID_FLAG.slices : 0
  words.set([shape.cells[0], shape.cells[1], shape.cells[2], shape.pixelShift], at.grid)
  // The reference reads the level `max(log2(cell) - 1, 0)` of a pyramid whose first level is half the view's size
  // (`HZBMipLevel`, the culling's draw); ours starts at the full size, so the same texels are one level up.
  words.set(
    [
      scene.entries,
      gridCellCount(shape.cells),
      Math.max(shape.pixelShift - 1, 0) + 1,
      image.frame & 7,
    ],
    at.limits,
  )
}
