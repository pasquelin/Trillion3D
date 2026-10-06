import * as G from '../host/graph/graph.fixture.ts'
import { surfaceOf } from '../page/surface.ts'
import type { VisPage } from './buffer.ts'
import { triangleAt } from './math.ts'
import { UV_GRADIENTS_WGSL } from './shader/shadeDeclWgsl.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import type { EngineCamera } from '../camera/world.ts'
import { DEFAULT_PIXEL_RATIO } from '../backend/common.ts'
import { locationOf, type PageLocations } from '../page/selection/placements.ts'
import { identityRoots } from '../page/selection/placements.fixture.ts'
import { unpackVisibilityId } from '../../../../bench/oracles/browser/cpu-image/ids.ts'

export function camera() {
  const cam = G.perspectiveCamera(55, 1, 0.1, 100)
  cam.position.z = 5
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return cam
}

export function quadPages(
  material: G.GraphSurface,
  uv?: number[],
): { pages: VisPage[]; geometry: G.Geometry; roots: ReturnType<typeof identityRoots> } {
  const geometry = new G.Geometry()
  geometry.setAttribute('position', G.floatAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3))
  if (uv) geometry.setAttribute('uv', G.floatAttribute(uv, 2))
  geometry.setIndex(G.indices([0, 1, 2, 0, 2, 3]))
  const pages: VisPage[] = [
    {
      array: new Uint32Array([0, 1, 2]),
      attributes: geometry.attributes,
      material: surfaceOf(material),
      clusterId: '0/0/0',
    },
    {
      array: new Uint32Array([0, 2, 3]),
      attributes: geometry.attributes,
      material: surfaceOf(material),
      clusterId: '0/0/1',
    },
  ]
  return { pages, geometry, roots: identityRoots() }
}

export function centerId(ids: Uint32Array, width: number, height: number) {
  return ids[((height / 2) | 0) * width + ((width / 2) | 0)]
}

/** A 2×2 RGBA map sampled nearest — red, green, blue, white — its rows as stored. */
export function nearestQuadTexture() {
  const map = G.dataTexture(
    new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
    2,
    2,
    G.HOST_FORMAT_RGBA,
  )
  map.magFilter = G.HOST_FILTER_NEAREST
  map.minFilter = G.HOST_FILTER_NEAREST
  map.flipY = false
  map.needsUpdate = true
  return map
}

/** Analytical UV derivatives of the winning triangle, by the resolve's own gradients. Not a finite
 *  difference across visbuffer discontinuities. */
export function visibilityUvDerivatives(
  ids: Uint32Array,
  pages: VisPage[],
  locations: PageLocations,
  cam: EngineCamera,
  viewport: [number, number],
  x: number,
  y: number,
  pixelRatio = DEFAULT_PIXEL_RATIO,
) {
  const [width, height] = viewport,
    unpacked = unpackVisibilityId(ids[y * width + x])
  if (!unpacked) return null
  const page = pages[unpacked.pageIndex]
  if (!page) return null
  const tri = triangleAt(
    page,
    locationOf(locations, unpacked.pageIndex).world,
    unpacked.triangleIndex,
    cam,
    width,
    height,
    pixelRatio,
  )
  if (!tri) return null
  const uv = page.attributes.uv
  const uva: [number, number] = uv ? [uv.getX(tri.i0), uv.getY(tri.i0)] : [0, 0]
  const uvb: [number, number] = uv ? [uv.getX(tri.i1), uv.getY(tri.i1)] : [0, 0]
  const uvc: [number, number] = uv ? [uv.getX(tri.i2), uv.getY(tri.i2)] : [0, 0]
  const at = (p: { x: number; y: number }) => [p.x, p.y],
    iw = [tri.a.invW, tri.b.invW, tri.c.invW]
  const [dx, dy] = uvGradients(at(tri.a), at(tri.b), at(tri.c), [x, y], uva, uvb, uvc, iw)
  return { duDx: dx[0], dvDx: dx[1], duDy: dy[0], dvDy: dy[1] }
}

/** The resolve's own UV gradients (`UV_GRADIENTS_WGSL`), run as shipped: the columns `d(u,v)/dx`
 *  and `d(u,v)/dy`. */
const { uvGradients } = shaderRun<{
  uvGradients: (...corners: number[][]) => [number[], number[]]
}>(UV_GRADIENTS_WGSL, ['uvGradients'], { mat2x2f: (dx: number[], dy: number[]) => [dx, dy] })
