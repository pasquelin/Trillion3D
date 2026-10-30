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
import { clearedColourTarget, makeFullscreenPipeline } from './fullscreen.ts'
import { TOON_DATA_FORMATS } from './tilePass.ts'
import type { ToonDataViews } from './toonData.ts'
import { colourLayoutEntries, unlitLayoutEntries } from './layoutEntries.ts'
import { createPassGroup } from './passGroup.ts'

/**
 * The lit image's first draw (`surfaceColourMain`, `colourPassWgsl.ts`): one fullscreen triangle that
 * writes every pixel of `hdr` — the background, the surfaces shown as they are, the emission of the
 * lit ones — before the draws of the lights add to it. It opens the lit image's one render pass
 * (`begin`, which clears the image): the image is held in tile memory from this draw to the indirect
 * light's (`createLitProgram`), loaded and stored once. Where the lights write the toon data (`ContractKey.toonData`) the pass has its two targets
 * as well, cleared with the image: a draw of the pass names every target the pass has, the toon ones held (a write mask of none) by this one.
 */
export async function createSurfaceColourPass(device: GPUDevice, view: GPUBuffer) {
  const layout = device.createBindGroupLayout({ entries: colourLayoutEntries() })
  const module = await createCheckedShaderModule(
    device,
    wgslModule(SURFACE_COLOUR_WGSL),
    'SURFACE_COLOUR',
  )
  const [pipeline, toonPipeline] = await Promise.all(
    [false, true].map((toon) =>
      makeFullscreenPipeline(device, module, layout, SURFACE_COLOUR_ENTRY, [
        { format: HDR_FORMAT },
        ...(toon
          ? Object.values(TOON_DATA_FORMATS).map((format) => ({ format, writeMask: 0 }))
          : []),
      ]),
    ),
  )
  const group = createPassGroup(device, layout)
  const { target, descriptor } = clearedColourTarget(SURFACE_COLOUR_PASS)
  // The same image's pass begun again, the image kept as it is: after a draw the pass could not hold.
  const resumed = clearedColourTarget(SURFACE_COLOUR_PASS)
  resumed.target.loadOp = 'load'
  // The passes with the toon data's two targets, which the lights add to: cleared with the image, or kept as they are.
  const withToon = (loadOp: GPULoadOp) => {
    const own = clearedColourTarget(SURFACE_COLOUR_PASS)
    own.target.loadOp = loadOp
    const data = [0, 1].map(() => ({ ...own.target }))
    own.descriptor.colorAttachments = [own.target, ...data]
    return { ...own, data }
  }
  const plainBegun = { target, descriptor }
  const toonBegun = withToon('clear'),
    toonResumed = withToon('load')
  return {
    /** Begins the lit image's render pass on `hdr` again, loaded and stored, its viewport the `width` × `height`
     *  pixels drawn: the lights' draws that follow work the pass could not hold between them (the per-light
     *  draws of `shadowOnePassProjection` false, which a projection separates). With `toon`, the toon data's targets are kept as they are too. */
    resume(
      encoder: GPUCommandEncoder,
      hdr: GPUTextureView,
      width: number,
      height: number,
      toon?: ToonDataViews,
    ) {
      const own = toon ? toonResumed : resumed
      own.target.view = hdr
      if (toon) toonViews(toonResumed.data, toon)
      const pass = encoder.beginRenderPass(own.descriptor)
      pass.setViewport(0, 0, width, height, 0, 1)
      return pass
    },
    /** Begins the lit image's render pass on `hdr`, cleared, its viewport the `width` × `height`
     *  pixels drawn; the caller records the draws into it and ends it. */
    begin(
      encoder: GPUCommandEncoder,
      hdr: GPUTextureView,
      width: number,
      height: number,
      toon?: ToonDataViews,
    ) {
      const own = toon ? toonBegun : plainBegun
      own.target.view = hdr
      if (toon) toonViews(toonBegun.data, toon)
      const pass = encoder.beginRenderPass(own.descriptor)
      pass.setViewport(0, 0, width, height, 0, 1)
      return pass
    },
    /** Draws the pixels of `pass`'s viewport from `surface`, the emission under the ambient
     *  occlusion `occlusion` (`ambientOcclusionApplied`). */
    record(
      pass: GPURenderPassEncoder,
      surface: SurfaceBuffer,
      occlusion: GPUTextureView,
      toon = false,
    ) {
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
      pass.setPipeline(toon ? toonPipeline : pipeline)
      pass.setBindGroup(0, bound)
      pass.draw(3)
    },
    release: () => group.release(),
  }
}

/** Sets the views of the toon data's two attachments. */
function toonViews(attachments: GPURenderPassColorAttachment[], toon: ToonDataViews) {
  attachments[0].view = toon.diffuse
  attachments[1].view = toon.weights
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
  const { target, descriptor } = clearedColourTarget(SURFACE_COLOUR_PASS)
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
