// The frame's shadow-map raster and projection (`vsmEncode.ts`).
import type { EngineCamera } from '../../../../camera/world.ts'
import type { WebgpuPagesRuntime } from '../../runtime.ts'
import {
  encodeVirtualShadowProjection,
  type VsmProjectionLight,
} from '../../../../vsm/projectionPass.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS } from '../../../../vsm/projectionWgsl.ts'
import { shadowPageGroup } from '../../../shadow/pageGroup.ts'
import { taaRenderMatrix } from '../../../../taa/frame.ts'
import { invertMatrix4 } from '../../../../../../math/src/matrix/matrix4Inverse.ts'
import { multiplyMatrix4 } from '../../../../../../math/src/matrix/matrix4.ts'
import { ensureMask, maskLayersFor, type EngineVsm } from './engineVsm.ts'
import { projectionLight } from './vsmPlan.ts'
import { encodeVsmRenderAndTransmission } from './vsmTransmission.ts'

const viewInverse = new Float64Array(16),
  renderMatrix = new Float64Array(16),
  jitteredProjection = new Float64Array(16)

/** What a frame's VSM steps read: the engine, the device, the encoder, the camera, the shadow
 *  maps and their plan. */
export interface VsmFrame {
  rt: WebgpuPagesRuntime
  device: GPUDevice
  encoder: GPUCommandEncoder
  cam: EngineCamera
  vsm: EngineVsm
  plan: NonNullable<EngineVsm['plan']>
}

/** The projection the raster drew this image with, the TAA jitter in it (\`taaRenderMatrix\`):
 *  the depth the projection reconstructs each pixel from was drawn jittered, so the projection
 *  reconstructs it with the jittered view (#1363). */
function rasterProjection(rt: WebgpuPagesRuntime, cam: EngineCamera) {
  invertMatrix4(viewInverse, cam.view)
  renderMatrix.set(taaRenderMatrix(rt, cam))
  multiplyMatrix4(jitteredProjection, renderMatrix, viewInverse)
  return jitteredProjection
}

/** The non-cluster raster: the resident cluster rows at the main view's detail. */
export function encodeVsmRaster({ rt, device, encoder, cam, vsm, plan }: VsmFrame) {
  const { lights, gpu, vis, layout, run } = rt
  const [width, height] = gpu.targetSize
  const pageGroup = shadowPageGroup(rt, device)
  const { spheres, mobilityRows, rowLods, pageLayout } = lights
  if (!pageGroup || !spheres || !mobilityRows || !rowLods || !pageLayout || !vis.pageTable) return
  const p = cam.projection
  vsm.renderedPlan = plan
  vsm.stats.render = encodeVsmRenderAndTransmission(
    rt,
    vsm,
    encoder,
    vsm.res,
    { device, lights: plan.lights },
    {
      rowCount: layout.rows.packedCount,
      pageTable: vis.pageTable,
      spheres: spheres.buffer,
      mobility: mobilityRows,
      rowLods: rowLods.buffer,
      pageLayout,
      pageGroup,
      rowSpheres: spheres,
      camera: {
        eye: cam.eye,
        view: cam.view,
        focalPixels: Math.max((p[0] * width) / 2, (p[5] * height) / 2),
        near: cam.near,
        perspective: cam.perspective === 1,
        threshold: run.gate.pixelError,
      },
    },
  )
}

/** Projection: one pass, every light a channel reads (`planVsmFrame`: the first 64), four a layer
 *  of the mask array. None when the plan holds no light — every lamp culled, its cache entries
 *  still counted —: every light then reads no shadow (`planVsmFrame` assigns −1), so no pixel
 *  reads the mask, and a pass of no light would store no texel of it. True when it ran. */
export function encodeVsmProjection(
  { rt, device, encoder, cam, vsm, plan }: VsmFrame,
  projected: VsmProjectionLight[],
  views: GPUTextureView[],
) {
  const { lights, gpu, run } = rt
  const [width, height] = gpu.targetSize
  const store = lights.store
  const reads = Math.min(plan.lights.length, VSM_PROJECTION_MAX_PASS_LIGHTS)
  projected.length = reads
  for (let k = 0; k < reads; k++) {
    const l = plan.lights[k]
    projected[k] = projectionLight(store.light(l.id)!, l.firstId)
  }
  if (!projected.length) return false
  const layers = maskLayersFor(projected.length)
  // At the targets' size, as the scene textures are at theirs: the view rect is its
  // top-left, and a dynamic-resolution step does not remake it.
  const mask = ensureMask(device, vsm, gpu.allocatedSize[0], gpu.allocatedSize[1], layers)
  // The engine's shadow receiver, as the resolve wrote it (`receiverTargetWgsl.ts`).
  const receiver = gpu.surfaces!.receiverView
  const camera = {
    view: cam.view,
    projection: rasterProjection(rt, cam),
    perspective: cam.perspective === 1,
  }
  encodeVirtualShadowProjection(
    encoder,
    vsm.res,
    {
      device,
      depth: gpu.depthView!,
      normalRough: views[1],
      flags: views[3],
      width,
      height,
      bufferWidth: gpu.allocatedSize[0],
      bufferHeight: gpu.allocatedSize[1],
      camera,
      frameIndex: run.frame,
      mask: mask.view,
      maskTiles: mask.tilesView,
      receiver,
    },
    projected,
  )
  return true
}
