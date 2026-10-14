import type { BlendLighting } from '../core/blendBindEntries.ts'
import type { createWebgpuBindIdentity } from '../core/bindIdentity.ts'
import type { SurfaceBuffer } from '../../scene/surfaceBuffer.ts'
import type { WebgpuGpuState } from '../pages/state/gpu.ts'
import type { createForwardVariants } from '../../lighting/deferred/forwardVariants.ts'
import type { createWaterCopy } from './copy.ts'
import type { createWaterDepthRestore } from './depthRestore.ts'
import type { createWaterPasses } from './passes.ts'
import type { createWaterComposites } from './pipelines.ts'
import { nameWaterResources, waterCompositeEntries, type WaterSources } from './compositeGroup.ts'

type WaterComposites = Awaited<ReturnType<typeof createWaterComposites>>
/** What a water frame holds from image to image: its programs, its passes and its bind groups.
 *  What the composite's group names is held twice, with a group each (`groups`, by identity slot):
 *  the shadow maps' tables the lighting binds are double-buffered, and their frames take turns.
 *  What the passes' targets name is held apart (`targets`): they are rebound when one of them
 *  moves, never with the lighting. */
export type WaterFrameState = {
  device: GPUDevice
  layout: GPUBindGroupLayout
  composites: Awaited<ReturnType<typeof createForwardVariants<WaterComposites>>>
  restore: Awaited<ReturnType<typeof createWaterDepthRestore>>
  copy: Awaited<ReturnType<typeof createWaterCopy>>
  /** What the composite's group names, rewritten in place each frame. */
  sources: WaterSources
  identity: ReturnType<typeof createWebgpuBindIdentity>
  targets: ReturnType<typeof createWebgpuBindIdentity>
  groups: (GPUBindGroup | undefined)[]
  passes: ReturnType<typeof createWaterPasses>
  group?: GPUBindGroup
  surfaces?: SurfaceBuffer
}

/** The frame's targets and resources named; rebuilt only where one of them moved, the composite's
 *  group kept for each identity slot. */
export function bindWaterFrame(
  frame: WaterFrameState,
  gpu: WebgpuGpuState,
  uniform: GPUBuffer,
  lighting: BlendLighting,
  items: GPUBuffer,
  verdict: GPUBuffer,
) {
  const { surfaces, backdrop, deferred, volumeBuffer, hdrTexture, hdrView, depthView } = gpu
  if (!surfaces || !hdrTexture || !hdrView || !gpu.depthTexture || !depthView) return false
  if (!gpu.colorView || !backdrop?.active || !deferred || !volumeBuffer) return false
  const named = frame.targets.next
  named[0] = surfaces
  named[1] = depthView
  named[2] = backdrop
  named[3] = gpu.colorView
  named[4] = verdict
  named.length = 5
  if (frame.targets.moved()) {
    frame.surfaces = surfaces
    frame.restore.bind(depthView, verdict)
    frame.passes.bind(surfaces, backdrop.waterDepthView, gpu.colorView)
  }
  // The HDR target is one of two that take turns (`reflections/radiance.ts`): the copy holds a
  // group for each, the composite pass names it in its descriptor alone.
  frame.copy.bind(hdrView, backdrop.colorView, verdict)
  frame.passes.light(hdrView)
  const { identity, groups, sources } = frame
  sources.gpu = gpu
  sources.uniform = uniform
  sources.lighting = lighting
  sources.items = items
  sources.verdict = verdict
  nameWaterResources(identity.next, sources)
  const kept = identity.moved() ? undefined : groups[identity.slot]
  if (kept) {
    frame.group = kept
    return true
  }
  // Until it is made, the slot holds no group: a refused one is asked again.
  groups[identity.slot] = undefined
  frame.group = groups[identity.slot] = frame.device.createBindGroup({
    layout: frame.layout,
    entries: waterCompositeEntries(sources),
  })
  return true
}
