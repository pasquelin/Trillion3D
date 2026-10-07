import { scissorTo } from './bounds.ts'
import { createWaterFreeze } from './freeze.ts'
import { createWaterDepthRestore } from './depthRestore.ts'
import { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import { drawBlendRuns } from '../blend/draw.ts'
import { feedbackAttachment, surfaceColorAttachments } from '../pages/prepare/attachments.ts'
import type { BlendLighting } from '../core/blendBindEntries.ts'
import type { BlendPipelines } from '../blend/stagePipelines.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import type { WebgpuGpuState } from '../pages/state/gpu.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import { nameWaterResources, waterCompositeEntries } from './compositeGroup.ts'
import { createWaterCompositeLayout, createWaterComposites } from './pipelines.ts'
import { routedFilter } from '../blend/displayFilter.ts'
import { activeAsIsShare } from '../pages/prepare/asIsShareTarget.ts'
import { WATER_SURFACE_PASS, WATER_COMPOSITE_PASS } from './passLabels.ts'
import { createReach, type Reach } from '../blend/reach.ts'
import { createForwardVariants, type ForwardLit } from '../../lighting/deferred/forwardVariants.ts'
import { FULL_CONTRACT, type ContractKey } from '../../lighting/deferred/contractCuts.ts'

/**
 * The frame side of the water pass: the composite program, and everything an image reuses as long
 * as what it names does not change — the bind group, the two copies that freeze the backdrop, the
 * surface pass and the composite pass (`createWaterPasses`). The targets change on a resize, the
 * lighting resources when the shadow atlas or the probe grid arrive: `bind` writes their identities
 * and rebuilds only when one moved, so a still frame builds and allocates nothing.
 */
export async function createWaterFrame(
  device: GPUDevice,
  unbounded = false,
  feedback = true,
  lit?: ForwardLit,
  reach: Reach = createReach({ modes: [], share: false, filtered: false }),
) {
  const layout = createWaterCompositeLayout(device)
  const [composites, restore] = await Promise.all([
    // The composite lit with the code the scene's lights need (`createForwardVariants`).
    createForwardVariants(
      (key) => createWaterComposites(device, layout, unbounded, key, reach),
      lit,
    ),
    // The opaque depth's restore: the surface pass's first draw, on its targets.
    createWaterDepthRestore(device, feedback),
  ])
  const frame: WaterFrameState = {
    device,
    layout,
    composites,
    restore,
    freeze: createWaterFreeze(),
    identity: createWebgpuBindIdentity(),
    passes: createWaterPasses(),
  }
  return {
    /** The opaque depth's restore, whose lobed pipeline the lobed stage prepares
     *  (`lobedStage.ts`). */
    restore,
    /** The compile a frame of lobed transmissive items waits for while no composite with the lobe
     *  code is ready: the one with every code path, which lights any (`askLobedPrograms`). */
    lobedAwaited: () => composites.awaited(FULL_CONTRACT),
    /** Names the frame's targets and resources; false while one of them does not exist. */
    bind: (gpu: WebgpuGpuState, uniform: GPUBuffer, lighting: BlendLighting) =>
      bindWaterFrame(frame, gpu, uniform, lighting),
    /** Encodes the water pass on the image the blends left (`encodeWaterFrame`). */
    encode: (
      rt: WebgpuPagesRuntime,
      encoder: GPUCommandEncoder,
      pipelines: BlendPipelines,
      key: Partial<ContractKey>,
      lobed = false,
    ) => encodeWaterFrame(frame, rt, encoder, pipelines, key, lobed),
    dispose() {
      restore.dispose()
      frame.group = undefined
      frame.surfaces = undefined
    },
  }
}

type WaterComposites = Awaited<ReturnType<typeof createWaterComposites>>
/** What a water frame holds from image to image: its programs, its passes and its bind group. */
type WaterFrameState = {
  device: GPUDevice
  layout: GPUBindGroupLayout
  composites: Awaited<ReturnType<typeof createForwardVariants<WaterComposites>>>
  restore: Awaited<ReturnType<typeof createWaterDepthRestore>>
  freeze: ReturnType<typeof createWaterFreeze>
  identity: ReturnType<typeof createWebgpuBindIdentity>
  passes: ReturnType<typeof createWaterPasses>
  group?: GPUBindGroup
  surfaces?: SurfaceBuffer
}

/** The frame's targets and resources named; rebuilt only where one of them moved. */
function bindWaterFrame(
  frame: WaterFrameState,
  gpu: WebgpuGpuState,
  uniform: GPUBuffer,
  lighting: BlendLighting,
) {
  const { surfaces, backdrop, deferred, volumeBuffer, hdrTexture, hdrView, depthView } = gpu
  if (!surfaces || !hdrTexture || !hdrView || !gpu.depthTexture || !depthView) return false
  if (!gpu.colorView || !backdrop?.active || !deferred || !volumeBuffer) return false
  nameWaterResources(frame.identity.next, gpu, uniform, lighting)
  if (!frame.identity.moved()) return true
  frame.surfaces = surfaces
  frame.freeze.bind(hdrTexture, backdrop)
  frame.restore.bind(depthView)
  frame.passes.bind(surfaces, backdrop.waterDepthView, hdrView, gpu.colorView)
  frame.group = frame.device.createBindGroup({
    layout: frame.layout,
    entries: waterCompositeEntries(gpu, uniform, lighting),
  })
  return true
}

/**
 * Encodes the water pass on the image the blends left. The backdrop is frozen (`freeze.ts`) — the
 * lit image copied, the opaque depth restored, by the surface pass's first draw, into the depth the
 * surface stage tests —, the transmissive surfaces draw into the opaque resolve's material
 * surfaces, free since that resolve consumed them, and the water word into the display colour the
 * composition writes later — the surface flags stay the opaque resolve's, read by temporal
 * antialiasing and the composition after this pass —, with hardware depth written so the nearest
 * surface of a pixel is the one kept; then one fullscreen triangle lights and composes every water
 * pixel into the HDR target, which keeps what it held wherever no water is (the display layers
 * where their mask is set), and, when the frame has a share, its coverage as the reactive value
 * the blends and particles also write (`asIsShare.ts`). Both passes are scissored to the kept
 * surfaces (`bounds.ts`); the word clear stays full-target, a scissor does not bound a load clear.
 * The composite is the program of the frame's lights' `key` (`createForwardVariants`). With
 * `lobed`, `pipelines` are the lobed stage's (`lobedStage.ts`): the lobes target is one more
 * attachment, and the composite the program that reads it (`waterLobesWgsl.ts`); without, the
 * program without lobe code. Returns the surface draws encoded.
 */
function encodeWaterFrame(
  frame: WaterFrameState,
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  pipelines: BlendPipelines,
  key: Partial<ContractKey>,
  lobed: boolean,
) {
  const { group, passes } = frame
  if (!group || !frame.surfaces) throw new Error('WATER_NOT_BOUND')
  const rect = frame.freeze.encode(encoder, rt.blendState.waterBounds, rt.gpu.targetSize)
  const written = rt.vis.writesFeedback ? feedbackAttachment(rt) : undefined
  const pass = encoder.beginRenderPass(passes.surface(lobed, written))
  pass.setViewport(0, 0, rt.gpu.targetSize[0], rt.gpu.targetSize[1], 0, 1)
  scissorTo(pass, rect)
  frame.restore.draw(pass, lobed)
  rt.run.gpuDrawCalls++
  const encoded = drawBlendRuns(rt, frame.device, pass, 1, pipelines)
  pass.end()
  const share = activeAsIsShare(rt),
    filter = routedFilter(rt.gpu.displayFilter)
  const composite = encoder.beginRenderPass(passes.composite(filter, share?.view))
  scissorTo(composite, rect)
  composite.setPipeline(frame.composites.pick(key, lobed).at(!!filter, !!share))
  composite.setBindGroup(0, group)
  if (rt.gpu.reflection) composite.setBindGroup(1, rt.gpu.reflection.group)
  if (filter) composite.setBindGroup(2, filter.maskGroup)
  composite.draw(3)
  composite.end()
  return encoded
}

/**
 * The water pass's two render passes, built once and named again at `bind`: the surface pass —
 * the three material surfaces, the water word (cleared: zero says "no water here" to the
 * composite), the lobes the lobed stage writes (loaded, a pixel's read only where its word is set,
 * by the fragment that set it), the feedback target, whose load `feedbackAttachment` decides per
 * image —, its depth cleared then restored over the surface rectangle by the pass's first draw
 * (the only texels a surface draw tests and the composite reads); and the composite pass
 * (`createCompositePass`).
 */
function createWaterPasses() {
  const unnamed = undefined as unknown as GPUTextureView
  const depth: GPURenderPassDepthStencilAttachment = {
    view: unnamed,
    depthLoadOp: 'clear',
    depthClearValue: 0,
    depthStoreOp: 'store',
  }
  const word: GPURenderPassColorAttachment = {
    view: unnamed,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  }
  const lobes: GPURenderPassColorAttachment = { view: unnamed, loadOp: 'load', storeOp: 'store' }
  // The water's scene keeps every surface layer (`wantsEmissiveAo`): no slot is empty.
  const attachments: Array<GPURenderPassColorAttachment | null> = []
  const surfacePass: GPURenderPassDescriptor = {
    label: WATER_SURFACE_PASS,
    colorAttachments: attachments,
    depthStencilAttachment: depth,
  }
  const target: GPURenderPassColorAttachment = { view: unnamed, loadOp: 'load', storeOp: 'store' }
  return {
    bind(
      surfaces: SurfaceBuffer,
      waterDepth: GPUTextureView,
      hdr: GPUTextureView,
      color: GPUTextureView,
    ) {
      depth.view = waterDepth
      target.view = hdr
      word.view = color
      lobes.view = surfaces.lobesView
      attachments.length = 0
      attachments.push(...surfaceColorAttachments(surfaces).slice(0, 3), word)
    },
    /** The surface pass, with the lobes target where `lobed`, and the feedback `written`. */
    surface(lobed: boolean, written: GPURenderPassColorAttachment | undefined) {
      attachments.length = 4
      if (lobed) attachments.push(lobes)
      if (written) attachments.push(written)
      return surfacePass
    },
    composite: createCompositePass(target),
  }
}

/** The composite pass: the HDR `target`, then the display layers of `filter` and the share at
 *  `share` where the frame has them (`waterCompositeTargets`), in lists kept from frame to frame —
 *  an image allocates none. */
function createCompositePass(target: GPURenderPassColorAttachment) {
  /** The share's attachment, its view named each image that has one (`asIsShare.ts`). */
  const shareTarget: GPURenderPassColorAttachment = { ...target }
  const plain = [target],
    routed: GPURenderPassColorAttachment[] = []
  const pass: GPURenderPassDescriptor = {
    label: WATER_COMPOSITE_PASS,
    colorAttachments: plain,
  }
  return (filter: ReturnType<typeof routedFilter>, share: GPUTextureView | undefined) => {
    if (!filter && !share) pass.colorAttachments = plain
    else {
      routed.length = 0
      routed.push(target)
      if (filter) for (const layer of filter.attachments()) routed.push(layer)
      if (share) {
        shareTarget.view = share
        routed.push(shareTarget)
      }
      pass.colorAttachments = routed
    }
    return pass
  }
}

export type WaterFrame = Awaited<ReturnType<typeof createWaterFrame>>
