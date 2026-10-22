import { retire } from '../../../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../../../gpu/core/textureBytes.ts'
import { BLOOM_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../../../scene/targetFormats.ts'
import { TRANSFORM_FORMAT } from './convolutionPrograms.ts'

/** A texture made at a size, and the view it is read through. */
interface Image {
  texture: GPUTexture
  view: GPUTextureView
  width: number
  height: number
}

/** The images and buffers every convolution of a chain draws through (`createConvolutionTargets`). */
export type ConvolutionTargets = ReturnType<typeof createConvolutionTargets>

/**
 * THE IMAGES EVERY CONVOLUTION OF A CHAIN DRAWS THROUGH: the image the transform reads, the four
 * planes of its spectrum and the glow it writes. The convolutions of a chain run one after the
 * other, each done with them before the next begins, so one set serves them all, made when the
 * first asks and again when the plan's sizes move, given back when none draws.
 */
export function createConvolutionTargets(device: GPUDevice) {
  let input: Image | undefined, glow: Image | undefined, planes: GPUBuffer | undefined
  const image = (width: number, height: number, format: GPUTextureFormat, usage: number): Image => {
    const texture = device.createTexture({
      label: BLOOM_PASS,
      size: { width, height },
      format,
      usage: usage | GPUTextureUsage.TEXTURE_BINDING,
    })
    return { texture, view: texture.createView(), width, height }
  }
  const stale = (held: Image | undefined, width: number, height: number) =>
    !held || held.width !== width || held.height !== height
  const drop = (held: Image | undefined) => held && retire(device, held.texture)
  return {
    /** The image the transform reads, `width × height`: drawn to, read as a texture. */
    inputImage(width: number, height: number) {
      if (stale(input, width, height)) {
        drop(input)
        input = image(width, height, TRANSFORM_FORMAT, GPUTextureUsage.RENDER_ATTACHMENT)
      }
      return input!.view
    },
    /** The glow, `width × height`: written by the transform, read as a texture. */
    glowImage(width: number, height: number) {
      if (stale(glow, width, height)) {
        drop(glow)
        glow = image(width, height, HDR_FORMAT, GPUTextureUsage.STORAGE_BINDING)
      }
      return glow!.view
    },
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
      let bytes = planes?.size ?? 0
      for (const held of [input, glow]) if (held) bytes += madeTextureBytes(held.texture)
      return bytes
    },
    /** Everything given back. */
    dispose() {
      for (const held of [input, glow]) drop(held)
      if (planes) retire(device, planes)
      input = glow = planes = undefined
    },
  }
}
