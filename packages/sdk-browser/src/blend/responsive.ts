import type { Blending, TranslucencyPass } from '../../../sdk-core/src/world/constants/index.ts'

/** The responsiveness the layers over a pixel carry into its temporal analysis: one channel, so the
 *  blend pass's targets stay within WebGPU's 32 colour bytes a sample. */
export const RESPONSIVE_FORMAT: GPUTextureFormat = 'r8unorm'
/** Bytes per pixel of the target, as the frame's target cost counts them (`targets.ts`). */
export const RESPONSIVE_BYTES = 1

/** The blend modes whose layers mark the responsiveness: translucent, additive and the one that
 *  multiplies the scene. */
const MARKING_BLENDS: ReadonlySet<Blending | undefined> = new Set([
  undefined,
  'normal',
  'additive',
  'multiply',
])

/** Whether the layers of a surface write their responsiveness code: those of the pass before the
 *  depth of field, drawn in one of `MARKING_BLENDS`; the others, drawn after the depth of field or
 *  the motion blur or composing with the scene another way, write none. */
export const marksResponsive = (surface: {
  translucencyPass?: TranslucencyPass | undefined
  blending?: Blending | undefined
}) => surface.translucencyPass === 'beforeDepthOfField' && MARKING_BLENDS.has(surface.blending)

/** The largest of what each layer writes is kept, in any order. */
const KEEP_LARGEST: GPUBlendComponent = { operation: 'max', srcFactor: 'one', dstFactor: 'one' }

/** The responsive target as a blend or a transmissive layer writes it (`shader.ts`): the mark of its
 *  surface's responsiveness code (`blendResponsive`, `RESPONSIVE_MARK_WGSL`) where it covers the
 *  pixel, the pixel keeping the largest of its layers' — which holds every bit any of them carries —
 *  and a layer of no responsiveness writing 0, which lowers none. */
export const RESPONSIVE_TARGET: GPUColorTargetState = {
  format: RESPONSIVE_FORMAT,
  blend: { color: KEEP_LARGEST, alpha: KEEP_LARGEST },
}

/**
 * The responsiveness the blends and transmissive layers over each pixel of the current image carry
 * (`RESPONSIVE_TARGET`), cleared to 0 on an image whose blends carry some into a temporal pass
 * (`../frame/prepare/responsiveTarget.ts`): the nearest velocity reads it as the flags of the
 * pixel, with those of an opaque surface's (`../post/taa/nearestVelocityWgsl.ts`). A particle
 * carries none; an image whose blends all carry none neither clears nor binds it, the analysis
 * reading a 1×1 zero.
 */
export function createResponsive(device: GPUDevice, width: number, height: number) {
  const texture = device.createTexture({
    label: 'Trillion3D current responsiveness',
    size: { width, height },
    format: RESPONSIVE_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  })
  const view = texture.createView()
  const descriptor: GPURenderPassDescriptor = {
    colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
  }
  return {
    view,
    /** Clears the responsiveness to 0 before the blends write it. */
    clear(encoder: GPUCommandEncoder, label: string) {
      descriptor.label = label
      encoder.beginRenderPass(descriptor).end()
    },
    dispose() {
      texture.destroy()
    },
  }
}

export type Responsive = ReturnType<typeof createResponsive>
