import type { EngineCamera } from '../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { SelectionUniforms } from '../../gpu/core/selection.ts'
import { readRasterSetting } from '../../../../sdk-core/src/contracts/rasterOptions.ts'
import { tessellationWanted } from '../tessellation/wanted.ts'
import { depthBucketsOn } from './depthBuckets.ts'

/** The span of the depth buckets, in metres, kept between images. */
const BUCKETS = { minZ: 0, maxZ: 0 }

/**
 * What the cluster cull judges the rasters by (`SelectionUniforms.raster`, the cull
 * `../../geometry/dag/shader/visibleWgsl.ts`), for the view `cam` drawn `height` pixels tall, written
 * into `uniforms`: whether the software raster is on (the `softwareRaster` option), the view's pixels per
 * unit at depth one over `hardwareRasterEdgePixels` — the edge a cluster goes to the hardware raster
 * at —, whether the frame tessellates the displaced surfaces (the clusters whose surface is displaced are
 * then neither rastered: the seeding of the patches takes them) and the span the depth buckets
 * spread over (`depthBucketsMinZ`, `depthBucketsMaxZ`), absent while the buckets are off.
 */
export function writeRasterJudgement(
  rt: WebgpuPagesRuntime,
  cam: EngineCamera,
  height: number,
  uniforms: SelectionUniforms,
) {
  const raster = (uniforms.raster ??= {
    software: true,
    hardwareEdge: 0,
    tessellation: false,
    buckets: undefined,
  })
  raster.software = readRasterSetting(rt, 'softwareRaster')
  raster.hardwareEdge =
    (0.5 * cam.projection[5]! * height) / readRasterSetting(rt, 'hardwareRasterEdgePixels')
  // The tessellation draws the image's displaced surfaces when it is wanted and the raster holds it.
  raster.tessellation = tessellationWanted(rt)
  if (depthBucketsOn(rt)) {
    BUCKETS.minZ = readRasterSetting(rt, 'depthBucketsMinZ')
    BUCKETS.maxZ = readRasterSetting(rt, 'depthBucketsMaxZ')
    raster.buckets = BUCKETS
  } else raster.buckets = undefined
}
