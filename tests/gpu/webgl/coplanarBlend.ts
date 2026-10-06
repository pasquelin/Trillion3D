// A two-sided BLEND record over the opaque base it lies on: drawn back then front, with or without
// the depth offset of a raised coplanar layer.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import type { WebglClusterRenderer } from '../../../packages/sdk-browser/src/webgl/cluster/renderer.ts'
import type { WebglClusterScene } from '../../../packages/sdk-browser/src/webgl/cluster/lights.ts'
import type { HostDrawCamera } from '../../../packages/sdk-browser/src/camera/world.ts'
import { clusterRecord } from './clusterPixels.ts'

/** The geometry the blend proof draws: two coplanar triangles, the first's winding reversed when
 *  asked. */
type GeometryFactory = (reverseFirst?: boolean) => G.Geometry

/** The opaque `base` record, then the green two-sided BLEND record over it; `biased`, the BLEND
 *  record carries a raised layer's offset. Returns what the draw submitted. */
export function drawCoplanarBlend(
  renderer: WebglClusterRenderer,
  scene: WebglClusterScene,
  camera: HostDrawCamera,
  geometry: GeometryFactory,
  base: G.GraphSurface,
  biased: boolean,
) {
  const source = G.basicSurface({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    depthFunc: G.DEPTH_LESS,
    side: G.DOUBLE_SIDE,
  })
  const layer = clusterRecord(geometry(true), source, [0], [3])
  layer.polygonOffsetUnits = biased ? -8 : undefined
  return renderer.draw(
    [clusterRecord(geometry(), base, [0], [3]), layer],
    scene,
    camera,
    false,
    false,
  )
}
