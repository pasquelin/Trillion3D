import { retire } from '../../../../gpu/core/frameRetire.ts'
import { BLOOM_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../../../scene/targetFormats.ts'
import { sizedImage } from '../../../filters/sizedImage.ts'

/** The images and buffers every convolution of a chain draws through (`createConvolutionTargets`). */
export type ConvolutionTargets = ReturnType<typeof createConvolutionTargets>

/**
 * THE IMAGES EVERY CONVOLUTION OF A CHAIN DRAWS THROUGH: the image the transform reads where the
 * level is not it, the four planes of its spectrum and the glow it writes. The convolutions of a
 * chain run one after the other, each done with them before the next begins, so one set serves them
 * all, made when the first asks and again when the plan's sizes move, given back when none draws.
 */
export function createConvolutionTargets(device: GPUDevice) {
  const input = sizedImage(
    device,
    BLOOM_PASS,
    HDR_FORMAT,
    GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  )
  const glow = sizedImage(device, BLOOM_PASS, HDR_FORMAT, GPUTextureUsage.STORAGE_BINDING)
  let planes: GPUBuffer | undefined
  return {
    /** The image the transform reads, `width × height`: drawn to, read as a texture. */
    inputImage: input.view,
    /** The input given back: the level the transform reads needs none. */
    dropInput: input.release,
    /** The glow, `width × height`: written by the transform, read as a texture. */
    glowImage: glow.view,
    /** The four planes of the image's spectrum, `bytes` in all. */
    spectrum(bytes: number) {
      if (planes?.size !== bytes) {
        if (planes) retire(device, planes)
        planes = device.createBuffer({
          label: BLOOM_PASS,
          size: bytes,
          usage: GPUBufferUsage.STORAGE,
        })
      }
      return planes!
    },
    /** Bytes of every image and of the planes. */
    get bytes() {
      return (planes?.size ?? 0) + input.bytes + glow.bytes
    },
    /** Everything given back; nothing to do where nothing was made. */
    dispose() {
      if (!planes && !input.bytes && !glow.bytes) return
      input.release()
      glow.release()
      if (planes) retire(device, planes)
      planes = undefined
    },
  }
}
