// The frame's shadow-map raster and projection (`vsmEncode.ts`).
import type { EngineCamera } from '../../../../camera/engineCamera.ts'
import type { WebgpuPagesRuntime } from '../../../../frame/backend/runtime.ts'
import {
  encodeVirtualShadowProjection,
  writeVsmProjectionFrame,
} from '../projection/projectionPass.ts'
import { VSM_PROJECTION_MAX_PASS_LIGHTS } from '../projection/projectionView.ts'
import { shadowPageGroup } from '../../casters/pageGroup.ts'
import { stochasticPhase } from '../../../../post/taa/frameState.ts'
import { shadowEpoch } from '../../../../frame/backend/state/shadowEpoch.ts'
import { shadowsUnsettled } from '../../../../frame/backend/state/lights.ts'
import { ensureMask } from './vsmMask.ts'
import type { EngineVsm } from './engineVsm.ts'
import type { VsmFrameScratch } from './vsmEncode.ts'
import { projectionLight } from './vsmPlan.ts'
import { vsmRasterScene } from './vsmRasterScene.ts'
import { vsmMapSettings } from './vsmFarShadow.ts'
import { vsmTraceKey } from './vsmProjectionHold.ts'
import { encodeVsmRenderAndTransmission } from './vsmTransmission.ts'
import { vsmShadowTessellation } from '../tessellation/shadowChain.ts'
import { encodeRowBins } from '../rows/rowBinsGpu.ts'

/** What a frame's VSM steps read: the engine, the device, the encoder, the camera, the projection
 *  the raster drew this image with (the TAA jitter in it, `taaRenderProjection`: the depth the
 *  marking and the projection reconstruct each pixel from was drawn jittered, #1363), the shadow
 *  maps and their plan. */
export interface VsmFrame {
  rt: WebgpuPagesRuntime
  device: GPUDevice
  encoder: GPUCommandEncoder
  cam: EngineCamera
  projection: Float64Array
  vsm: EngineVsm
  plan: NonNullable<EngineVsm['plan']>
}

/** The non-cluster raster: the resident cluster rows at the main view's detail. */
export function encodeVsmRaster({ rt, device, encoder, cam, vsm, plan }: VsmFrame) {
  const { lights, vis, layout } = rt
  const pageGroup = shadowPageGroup(rt, device)
  const { spheres, mobilityRows, rowLods, pageLayout } = lights
  if (!pageGroup || !spheres || !mobilityRows || !rowLods || !pageLayout || !vis.pageTable) return
  vsm.renderedPlan = plan
  const tessellation = vsmShadowTessellation(rt, device, vsm, pageLayout)
  const held = { pageTable: vis.pageTable, spheres, mobility: mobilityRows, rowLods }
  const scene = vsmRasterScene(rt, cam, plan, { ...held, pageLayout, pageGroup }, tessellation)
  const frame = { device, lights: plan.lights }
  vsm.stats.render = encodeVsmRenderAndTransmission(rt, vsm, encoder, vsm.res, frame, scene)
  // The histograms the chunks of a later frame are sized from (`rowPageBound.ts`): the spheres as
  // the rows pass wrote them this frame, the raster's rows and the blended casters'.
  const binned = { spheres: spheres.buffer, mobility: mobilityRows, rowSpheres: spheres },
    { rows } = layout
  const raster = vsm.res.render?.rowBound,
    blended = vsm.transmission?.context?.rowBound
  const blendedRows = { first: rows.blendFirst, end: rows.casterSlots }
  if (raster)
    encodeRowBins(device, encoder, raster, binned, { first: 0, end: rows.packedCount }, plan.lights)
  if (blended) encodeRowBins(device, encoder, blended, binned, blendedRows, plan.lights)
}

/** The frame's projection context (`VsmProjectionFrame`), rebuilt in place in `scratch` from the
 * plan's lights a channel reads (`planVsmFrame`: the first 64), the camera, the phase and the depth
 * pyramid, and written once into the view uniform (`writeVsmProjectionFrame`): what the opaque
 * projection and the translucent layers' traces read, whether the projection runs or is held. None when the plan
 * holds no light — every lamp culled, its cache entries still counted —: every light then reads no
 * shadow (`planVsmFrame` assigns −1), so no pixel reads a mask —, nor without the pyramid. */
function projectionContext(
  { rt, device, cam, projection, vsm, plan }: VsmFrame,
  scratch: VsmFrameScratch,
) {
  const { lights, gpu } = rt
  const store = lights.store
  const context = scratch.context
  const projected = context.lights
  const reads = Math.min(plan.lights.length, VSM_PROJECTION_MAX_PASS_LIGHTS)
  projected.length = reads
  for (let k = 0; k < reads; k++) {
    const l = plan.lights[k]
    projected[k] = projectionLight(store.light(l.id)!, l.firstId)
  }
  // The depth the screen ray marches, its pyramid complete (`encodeDepthPyramid`).
  const hizDepth = rt.vis.gpuHiz?.depth()
  if (!projected.length || !hizDepth) return undefined
  context.device = device
  context.hizDepth = hizDepth
  context.width = gpu.targetSize[0]
  context.height = gpu.targetSize[1]
  context.camera.view = cam.view
  context.camera.projection = projection
  context.camera.perspective = cam.perspective === 1
  context.frameIndex = stochasticPhase(gpu.temporal?.frame)
  context.trace = vsmMapSettings(rt).shadows
  writeVsmProjectionFrame(vsm.res, context)
  scratch.projecting = true
  return context
}

/** Projection of the opaque surfaces: one pass, every light of the frame's context, four a layer
 *  of the engine's mask. A frame whose inputs are the last projection's, the shadow pages
 *  settled, runs none: its mask is that projection's (`vsmProjectionHold.ts`). The passes it ran:
 *  0 or 1. */
function encodeVsmProjection(frame: VsmFrame, scratch: VsmFrameScratch, views: GPUTextureView[]) {
  const { rt, device, encoder, cam, projection, vsm } = frame
  const context = projectionContext(frame, scratch)
  if (!context) return 0
  const { lights, gpu } = rt
  // At the targets' size, as the scene textures are at theirs: the view rect is its
  // top-left, and a dynamic-resolution step does not remake it.
  const [width, height] = gpu.allocatedSize
  const mask = ensureMask(device, vsm, width, height, context.lights.length)
  const source = scratch.opaque
  source.depth = gpu.depthView!
  source.normalRough = views[1]
  source.flags = views[3]
  // The engine's shadow receiver, as the resolve wrote it (`receiverTargetWgsl.ts`).
  source.receiver = gpu.surfaces!.receiverView
  // The translucent casters' memory, whose panes each missed ray multiplies (`vsmRayThrough`).
  source.transmission = vsm.transmission?.view
  const hold = vsm.projectionHold.inputs
  hold.view = cam.view
  hold.projection = projection
  hold.revisions = rt.run.gate.revisions
  hold.lightsEpoch = lights.store.epoch
  hold.shadowEpoch = shadowEpoch(lights)
  hold.phase = context.frameIndex
  hold.trace = vsmTraceKey(context.trace!)
  hold.size = gpu.allocatedSize
  hold.lights = context.lights
  const held = vsm.projectionHold.held(mask.array)
  if (held && !shadowsUnsettled(lights, rt.rowWords)) return 0
  encodeVirtualShadowProjection(encoder, vsm.res, context, source, mask)
  vsm.projectionHold.keep(mask.array)
  return 1
}

/** The projection `encodeVsmFrame` held, encoded now that the depth pyramid holds this image's depth and
 *  its transparents' front (`encodeDepthPyramid`), which its screen rays march; none where none was held. */
export function encodeHeldVsmProjection(rt: WebgpuPagesRuntime) {
  const vsm = rt.lights.vsm,
    scratch = vsm?.frameScratch,
    held = scratch?.held
  if (!vsm || !scratch) return
  scratch.projecting = false
  if (!held) return
  scratch.held = undefined
  vsm.stats.projectionPasses = encodeVsmProjection(held.frame, scratch, held.views)
}
