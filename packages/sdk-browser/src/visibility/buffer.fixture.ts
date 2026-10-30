import * as G from '../scene/host/graph/graph.fixture.ts'
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'
import { surfaceOf, type PageSurface } from '../geometry/pages/surface.ts'
import type { VisPage } from './types.ts'
import { triangleAt } from '../../../../bench/oracles/browser/cpu-image/projection.ts'
import { UV_GRADIENTS_WGSL } from './shader/uvGradientsWgsl.ts'
import { PIXEL_BARYCENTRIC_WGSL } from './shader/pixelBarycentricWgsl.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import type { EngineCamera } from '../camera/engineCamera.ts'
import { DEFAULT_PIXEL_RATIO } from '../session/engine/common.ts'
import { locationOf, type PageLocations } from '../geometry/selection/placements.ts'
import { identityRoots } from '../geometry/selection/placements.fixture.ts'
import { unpackVisibilityId } from '../../../../bench/oracles/browser/cpu-image/ids.ts'

export function camera() {
  const cam = G.perspectiveCamera(55, 1, 0.1, 100)
  cam.position.z = 5
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return cam
}

export function quadPages(
  material: PageSurface,
  uv?: number[],
): { pages: VisPage[]; geometry: Geometry; roots: ReturnType<typeof identityRoots> } {
  const geometry = new Geometry()
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
  return G.dataTexture(
    new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
    2,
    2,
  )
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
  const at = (p: { x: number; y: number }) => [p.x, p.y, 0],
    iw = [tri.a.invW, tri.b.invW, tri.c.invW]
  const [s0, s1, s2] = [at(tri.a), at(tri.b), at(tri.c)]
  const area = (s2[0]! - s1[0]!) * (s0[1]! - s1[1]!) - (s2[1]! - s1[1]!) * (s0[0]! - s1[0]!)
  const steps = pixelBarycentric(s0, s1, s2, iw, [x, y], area)
  const [dx, dy] = uvGradients(steps.dx, steps.dy, uva, uvb, uvc)
  return { duDx: dx[0], dvDx: dx[1], duDy: dy[0], dvDy: dy[1] }
}

/** The resolve's own UV gradients (`UV_GRADIENTS_WGSL`) over the weights' steps (`PIXEL_BARYCENTRIC_WGSL`), run as shipped: the columns `d(u,v)/dx`
 *  and `d(u,v)/dy`. */
const { uvGradients, pixelBarycentric } = shaderRun<{
  uvGradients: (...args: number[][]) => [number[], number[]]
  pixelBarycentric: (...args: unknown[]) => { value: number[]; dx: number[]; dy: number[] }
}>(
  wgslBlock('visibilityUvGradients', [PIXEL_BARYCENTRIC_WGSL, UV_GRADIENTS_WGSL], ''),
  ['uvGradients', 'pixelBarycentric'],
  { mat2x2f: (dx: number[], dy: number[]) => [dx, dy] },
)
