import { DEPTH_CLEAR } from '../../camera/depthConvention.ts'
import { surfaceColorAttachments } from '../pages/prepare/attachments.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import type { routedFilter } from '../blend/displayFilter.ts'
import { WATER_COMPOSITE_PASS, WATER_SURFACE_PASS } from './passLabels.ts'

/**
 * The water pass's two render passes, built once and named again at `bind` (the HDR target at
 * `light`, each frame): the surface pass —
 * the three material surfaces, the water word (cleared: zero says "no water here" to the
 * composite), the lobes the lobed stage writes (loaded, a pixel's read only where its word is set,
 * by the fragment that set it), the feedback target, whose load `feedbackAttachment` decides per
 * image —, its depth cleared then restored over the water rectangle by the pass's first draw (the
 * texels a surface draw tests, the composite reads them and their neighbours); and the composite
 * pass (`createCompositePass`).
 */
export function createWaterPasses() {
  const unnamed = undefined as unknown as GPUTextureView
  const depth: GPURenderPassDepthStencilAttachment = {
    view: unnamed,
    depthLoadOp: 'clear',
    depthClearValue: DEPTH_CLEAR,
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
    bind(surfaces: SurfaceBuffer, waterDepth: GPUTextureView, color: GPUTextureView) {
      depth.view = waterDepth
      word.view = color
      lobes.view = surfaces.lobesView
      attachments.length = 0
      attachments.push(...surfaceColorAttachments(surfaces).slice(0, 3), word)
    },
    /** The HDR target the composite lights the water into, this frame's. */
    light(hdr: GPUTextureView) {
      target.view = hdr
    },
    /** The surface pass, with the lobes target where `lobed`, the `front` depth and the feedback
     *  `written`. */
    surface(
      lobed: boolean,
      front: GPURenderPassColorAttachment,
      written: GPURenderPassColorAttachment | undefined,
    ) {
      attachments.length = 4
      if (lobed) attachments.push(lobes)
      attachments.push(front)
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
