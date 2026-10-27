import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { createCheckedShaderModule } from '../../gpu/core/shaderModule.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { SURFACE_COLOUR_PASS } from '../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import {
  SURFACE_COLOUR_ENTRY,
  SURFACE_COLOUR_WGSL,
  UNLIT_SURFACE_ENTRY,
  UNLIT_SURFACE_WGSL,
} from './colourPassWgsl.ts'
import { makeFullscreenPipeline } from './fullscreen.ts'
import { colourLayoutEntries, unlitLayoutEntries } from './layoutEntries.ts'
import { createPassGroup } from './passGroup.ts'

/** The lit image's target, cleared before the first draw writes every pixel of it. */
function colourTarget(label: string) {
  const target: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  }
  const descriptor: GPURenderPassDescriptor = { label, colorAttachments: [target] }
  return { target, descriptor }
}

/**
 * The lit image's first draw (`surfaceColourMain`, `colourPassWgsl.ts`): one fullscreen triangle that
 * writes every pixel of `hdr` — the background, the surfaces shown as they are, the emission of the
 * lit ones — before the draws of the lights add to it. It opens the lit image's one render pass
 * (`begin`, which clears the image): the image is held in tile memory from this draw to the indirect
 * light's (`createLitProgram`), loaded and stored once.
 */
export async function createSurfaceColourPass(device: GPUDevice, view: GPUBuffer) {
  const layout = device.createBindGroupLayout({ entries: colourLayoutEntries() })
  const module = await createCheckedShaderModule(
    device,
    wgslModule(SURFACE_COLOUR_WGSL),
    'SURFACE_COLOUR',
  )
  const pipeline = await makeFullscreenPipeline(device, module, layout, SURFACE_COLOUR_ENTRY, [
    { format: HDR_FORMAT },
  ])
  const group = createPassGroup(device, layout)
  const { target, descriptor } = colourTarget(SURFACE_COLOUR_PASS)
  // The same image's pass begun again, the image kept as it is: after a draw the pass could not hold.
  const resumed = colourTarget(SURFACE_COLOUR_PASS)
  resumed.target.loadOp = 'load'
  return {
    /** Begins the lit image's render pass on `hdr` again, loaded and stored, its viewport the `width` × `height`
     *  pixels drawn: the lights' draws that follow work the pass could not hold between them (the per-light
     *  draws of `shadowOnePassProjection` false, which a projection separates). */
    resume(encoder: GPUCommandEncoder, hdr: GPUTextureView, width: number, height: number) {
      resumed.target.view = hdr
      const pass = encoder.beginRenderPass(resumed.descriptor)
      pass.setViewport(0, 0, width, height, 0, 1)
      return pass
    },
    /** Begins the lit image's render pass on `hdr`, cleared, its viewport the `width` × `height`
     *  pixels drawn; the caller records the draws into it and ends it. */
    begin(encoder: GPUCommandEncoder, hdr: GPUTextureView, width: number, height: number) {
      target.view = hdr
      const pass = encoder.beginRenderPass(descriptor)
      pass.setViewport(0, 0, width, height, 0, 1)
      return pass
    },
    /** Draws the pixels of `pass`'s viewport from `surface`, the emission under the ambient
     *  occlusion `occlusion` (`ambientOcclusionApplied`). */
    record(pass: GPURenderPassEncoder, surface: SurfaceBuffer, occlusion: GPUTextureView) {
      const [colours, words] = surface.stores()
      const bound = group.get([surface, occlusion], () =>
        namedEntries(DEFERRED_BINDINGS, {
          colours,
          emissiveAo: surface.views()[2],
          words,
          view: { buffer: view },
          ambientOcclusion: occlusion,
        }),
      )
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bound)
      pass.draw(3)
    },
    release: () => group.release(),
  }
}

/**
 * The unlit view's pass (`unlitSurfaceMain`): the material's colour as it is, with the emission it
 * keeps, no light, no fog, no sky.
 */
export async function createUnlitPass(device: GPUDevice, view: GPUBuffer, label: string) {
  const layout = device.createBindGroupLayout({ entries: unlitLayoutEntries() })
  const module = await createCheckedShaderModule(
    device,
    wgslModule(UNLIT_SURFACE_WGSL),
    `UNLIT_${label}`,
  )
  const pipeline = await makeFullscreenPipeline(device, module, layout, UNLIT_SURFACE_ENTRY, [
    { format: HDR_FORMAT },
  ])
  const group = createPassGroup(device, layout)
  const { target, descriptor } = colourTarget(SURFACE_COLOUR_PASS)
  return {
    draw(
      encoder: GPUCommandEncoder,
      hdr: GPUTextureView,
      surface: SurfaceBuffer,
      width: number,
      height: number,
    ) {
      const [colours, words] = surface.stores()
      const bound = group.get([surface], () =>
        namedEntries(DEFERRED_BINDINGS, {
          colours,
          emissiveAo: surface.views()[2],
          words,
          view: { buffer: view },
        }),
      )
      target.view = hdr
      drawFullscreenTriangle(encoder, descriptor, pipeline, bound, width, height)
    },
    release: () => group.release(),
  }
}
