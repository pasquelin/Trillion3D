import { AS_IS_SHARE_SHADER } from './asIsShareWgsl.ts'
import { BLEND_EQUATIONS } from '../../materials/surface/materialBlending.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { fullscreenDescriptor, preparedPipeline, started } from './fullscreen.ts'
import { AS_IS_SHARE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { sequentialEntries, computeTextureEntry } from '../../gpu/core/computeBindings.ts'

/** Red, the as-is share; green, the reactive value. */
export const AS_IS_SHARE_FORMAT: GPUTextureFormat = 'rg8unorm'
/** What the layers over a pixel give up of its temporal history, beside it: one channel, so the
 *  blend pass's targets stay within WebGPU's 32 colour bytes a sample (31 with the display
 *  layers; four channels would cost 8). */
const GIVEN_UP_FORMAT: GPUTextureFormat = 'r8unorm'
/** Bytes per pixel of both targets, as the frame's target cost counts them (`targets.ts`). */
export const AS_IS_SHARE_BYTES = 3

/** The target as a blend writes it (`../../blend/pipelines.ts`): its coverage over what
 *  the pixel holds, in both channels. */
export const SHARE_TARGET: GPUColorTargetState = {
  format: AS_IS_SHARE_FORMAT,
  blend: BLEND_EQUATIONS.normal,
}

/** The reactive value's target as a particle and a transmissive layer write it
 *  (`../../particles/gpu/webgpuParticleDraw.ts`, `../../blend/transmission/pipelines.ts`): the same,
 *  green alone (`GPUColorWrite.GREEN`). */
export const REACTIVE_TARGET: GPUColorTargetState = { ...SHARE_TARGET, writeMask: 0x2 }

/** The largest of what each layer writes is kept, in any order. */
const KEEP_LARGEST: GPUBlendComponent = { operation: 'max', srcFactor: 'one', dstFactor: 'one' }

/** The given-up target as a blend or a transmissive layer writes it
 *  (`../../blend/shader.ts`): the share of the history its surface gives up
 *  (`blendGivenUp`) times its coverage, the pixel keeping the largest of its layers' — a layer that
 *  keeps its whole history writes 0 and lowers none, a faint edge gives up little. */
export const GIVEN_UP_TARGET: GPUColorTargetState = {
  format: GIVEN_UP_FORMAT,
  blend: { color: KEEP_LARGEST, alpha: KEEP_LARGEST },
}

/** The seed's program, once a device, compiled off the thread from the first frame entry of a scene
 *  whose transparents or particles can write the share (`askAsIsSeed`): frame targets made again at
 *  another size compile nothing, and the image that first seeds finds it compiled. */
const seedProgram = oncePerDevice((device) => {
  const module = device.createShaderModule({
    label: 'Trillion3D as-is share seed',
    code: AS_IS_SHARE_SHADER,
  })
  const layout = device.createBindGroupLayout({
    entries: [computeTextureEntry(0, 'uint', '2d', GPUShaderStage.FRAGMENT)],
  })
  // By the pass's targets: the share alone, then with the history given up, which the pass
  // clears and the seed never draws.
  const pipelines = [[], [{ format: GIVEN_UP_FORMAT, writeMask: 0 }]].map((givenUp) =>
    started(
      preparedPipeline(
        device,
        fullscreenDescriptor(device, module, layout, 'seed', [
          { format: AS_IS_SHARE_FORMAT },
          ...givenUp,
        ]),
      ),
    ),
  )
  return { layout, pipelines }
})

/** Asks the seed's programs of `device` off the frame, the frames held until they landed
 *  (`../../frame/loop/framePipelines.ts`). */
export const askAsIsSeed = (device: GPUDevice) => {
  for (const pipeline of seedProgram(device).pipelines) pipeline.ask()
}

/**
 * The current image's debug-view share, seeded from opaque flags before transparents blend it, and
 * beside it the reactive value, seeded 0: each blend, particle and transmissive layer writes 1 at
 * its coverage over it (`../../blend/transmission/transmitWgsl.ts`), so a pixel behind transparents holds
 * their accumulated opacity. The temporal pass shortens a moving pixel's history by it
 * (`../../post/taa/historyWgsl.ts`).
 *
 * In a target of its own, what the blends and transmissive layers over the pixel give up of its
 * history (`GIVEN_UP_TARGET`), cleared to 0 on an image whose blends give some up to a temporal
 * pass (`blendShareTargets`): the history update caps the history's share by its complement as by
 * an opaque surface's (`../../post/taa/resolveWgsl.ts`). A particle gives up none; an image whose
 * blends all keep their history neither clears nor binds it, the update reading a 1×1 zero.
 */
export function createAsIsShare(
  device: GPUDevice,
  flags: GPUTextureView,
  width: number,
  height: number,
) {
  const texture = device.createTexture({
    label: 'Trillion3D current as-is share',
    size: { width, height },
    format: AS_IS_SHARE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  const view = texture.createView()
  const givenUp = device.createTexture({
    label: 'Trillion3D current history given up',
    size: { width, height },
    format: GIVEN_UP_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  const givenUpView = givenUp.createView()
  const { layout, pipelines } = seedProgram(device)
  const group = device.createBindGroup({ layout, entries: sequentialEntries([flags]) })
  const cleared = (target: GPUTextureView): GPURenderPassColorAttachment => ({
    view: target,
    loadOp: 'clear',
    storeOp: 'store',
    clearValue: [0, 0, 0, 0],
  })
  const attachments = [[cleared(view)], [cleared(view), cleared(givenUpView)]]
  return {
    view,
    givenUpView,
    /** Clears the share and its reactive value to 0, the history given up too where the image's
     *  blends write it (`givenUp`), then, on an image that can hold an as-is pixel (`asIs`,
     *  `readsAsIs`), seeds the share from the flags. Any other image's flags hold no as-is pixel
     *  (only a row shown as-is or a diagnostic view writes one): the seed would write the clear's
     *  zeros again, so its draw is left out. */
    seed(encoder: GPUCommandEncoder, asIs: boolean, givenUp: boolean) {
      const pass = encoder.beginRenderPass({
        label: AS_IS_SHARE_PASS,
        colorAttachments: attachments[+givenUp],
      })
      if (asIs) {
        pass.setPipeline(pipelines[+givenUp].get())
        pass.setBindGroup(0, group)
        pass.draw(3)
      }
      pass.end()
    },
    dispose() {
      texture.destroy()
      givenUp.destroy()
    },
  }
}

export type AsIsShare = ReturnType<typeof createAsIsShare>
