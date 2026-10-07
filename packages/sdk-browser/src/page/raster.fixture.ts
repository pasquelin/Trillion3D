// The CPU raster the visibility tests measure the engine's buffer against: every drawn page's
// triangles filled in the order the engine submits them (`rasterFill.fixture.ts`).
import { invertMatrix4, multiplyMatrix4 } from '../../../sdk-core/src/index.ts'
import { copyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { type MatrixElements } from '../host/matrixElements.ts'
import type { PageRec } from './selection/types.ts'
import { locationOf, type PageLocations } from './selection/placements.ts'
import type { PageSurface } from './surface.ts'
import { rasterTriangle, type RasterTarget } from './rasterFill.fixture.ts'
import { RASTER_BACKGROUND } from './raster.ts'
import { resolveCameraWorld, type HostCamera } from '../camera/world.ts'

/** A host camera with the projection it composed itself, in its own depth convention. */
type ProjectedCamera = HostCamera & { readonly projectionMatrix: MatrixElements }

/** Opaque image used before the first WebGPU readback and after every resize. */
export function opaqueBackgroundRgba(
  width: number,
  height: number,
  background = RASTER_BACKGROUND,
) {
  const pixels = new Uint8Array(width * height * 4)
  const red = (background >> 16) & 255,
    green = (background >> 8) & 255,
    blue = background & 255
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = red
    pixels[index + 1] = green
    pixels[index + 2] = blue
    pixels[index + 3] = 255
  }
  return pixels
}

const byteRgb = (r: number, g: number, b: number) => [(r * 255) | 0, (g * 255) | 0, (b * 255) | 0]

/** The eight-bit colour of a surface record the page carries. */
function surfaceColorOf(surface: PageSurface) {
  const base = surface.baseColor
  return byteRgb(base[0], base[1], base[2])
}

/** CPU raster of cluster page records: the triangles the engine pulls, in its fill rule. */
export function rasterPages(
  pages: Array<Pick<PageRec, 'array' | 'attributes' | 'material'>>,
  locations: PageLocations,
  camera: ProjectedCamera,
  viewport: [number, number],
  background = RASTER_BACKGROUND,
) {
  const [width, height] = viewport
  const target: RasterTarget = {
    pixels: opaqueBackgroundRgba(width, height, background),
    width,
    height,
  }
  const viewProj = cameraViewProjection(camera)
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i],
      position = page.attributes.position,
      index = page.array
    if (!position || !index) continue
    const rgb = surfaceColorOf(page.material),
      world = locationOf(locations, i).world.elements
    for (let i = 0; i < index.length; i += 3)
      rasterTriangle(target, world, position, viewProj, index[i], index[i + 1], index[i + 2], rgb)
  }
  return target.pixels
}

const projection = new Float64Array(16),
  viewWorld = new Float64Array(16),
  view = new Float64Array(16),
  viewProjection = new Float64Array(16)
/** Clip matrix of the drawn view, as the host composed it: its own projection, finite far plane
 *  included, times the inverse of the world pose the contract resolves. The inverse is taken
 *  here, in buffers the engine owns, rather than read off the camera the host handed over. */
function cameraViewProjection(camera: ProjectedCamera) {
  // Callable function alone: it resolves its own pose (contract: `../camera/world.ts`).
  resolveCameraWorld(camera)
  copyMatrix4(projection, camera.projectionMatrix.elements)
  copyMatrix4(viewWorld, camera.matrixWorld.elements)
  invertMatrix4(view, viewWorld)
  multiplyMatrix4(viewProjection, projection, view)
  return viewProjection
}
