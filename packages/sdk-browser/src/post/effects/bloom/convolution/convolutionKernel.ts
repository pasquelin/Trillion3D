import type { BloomKernelImage } from '../../../../../../sdk-core/src/contracts/bloomConvolutionOptions.ts'
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../../../gpu/core/textureBytes.ts'
import { BLOOM_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import { FFT_BYTES, FFT_PARAMS } from './fftWgsl.ts'
import { KERNEL_BYTES, KERNEL_PARAMS, KERNEL_TILE } from './kernelWgsl.ts'
import {
  KERNEL_FORMAT,
  TRANSFORM_FORMAT,
  bindTo,
  convolutionPrograms,
  dispatchStage,
} from './convolutionPrograms.ts'
import { analyseKernel, type KernelStats } from './kernelStats.ts'
import type { ConvolutionPlan } from './plan.ts'
import { transformShape, writeTransformWords } from './transformShape.ts'

/** Whether a kernel's transform made for the kernel `image` and the plan `made` is the one `image`
 *  and `plan` need: the same kernel, size, direction and sizes of the image and the transform. */
const sameKey = (
  held: { image: BloomKernelImage; plan: ConvolutionPlan },
  image: BloomKernelImage,
  plan: ConvolutionPlan,
) =>
  held.image === image &&
  held.plan.support === plan.support &&
  held.plan.horizontalFirst === plan.horizontalFirst &&
  held.plan.image[0] === plan.image[0] &&
  held.plan.image[1] === plan.image[1] &&
  held.plan.frequency[0] === plan.frequency[0] &&
  held.plan.frequency[1] === plan.frequency[1]

/** What the convolution reads of its kernel for an image: the transform of the kernel's picture, as
 *  four planes of half spectra (none for a kernel with no light), and what is read of the kernel. */
export interface KernelSpectrum {
  buffer: GPUBuffer | undefined
  stats: KernelStats
  /** The passes encoded to make it: none where it was kept. */
  passes: number
}

const tiles = (n: number) => ceilDiv(n, KERNEL_TILE)

type Programs = ReturnType<typeof convolutionPrograms>

/** The uniform of the kernel's passes (`KERNEL_PARAMS`), written for the kernel `image` and the
 *  plan. The alpha channel is the kernel's own where the post chain keeps one; the image's does not. */
function writeKernelUniform(
  device: GPUDevice,
  uniform: GPUBuffer,
  plan: ConvolutionPlan,
  stats: KernelStats,
  image: BloomKernelImage,
) {
  const words = new Float32Array(KERNEL_PARAMS.words),
    at = KERNEL_PARAMS.at
  const u32 = new Uint32Array(words.buffer)
  words.set(stats.maxScatter, at.limit)
  u32.set([plan.frequency[0], plan.frequency[1], 0, 0], at.dst)
  u32.set([plan.image[0], plan.image[1], stats.centre[0], stats.centre[1]], at.image)
  words.set([1 / image.width, 1 / image.height, plan.support, 0], at.scale)
  device.queue.writeBuffer(uniform, 0, words)
}

/**
 * The kernel prepared for the transform, in `encoder`: held to the haze beside its centre, halved
 * while it is more than twice the size it has over the image, then drawn at that size in the
 * transform's square about its centre. `source` is the kernel's picture; the textures made are
 * listed in `made`, for the caller to retire. Returns the picture drawn and the passes encoded.
 */
function prepareKernel(
  device: GPUDevice,
  programs: Programs,
  encoder: GPUCommandEncoder,
  uniform: GPUBuffer,
  plan: ConvolutionPlan,
  source: GPUTexture,
  made: GPUTexture[],
) {
  const make = (width: number, height: number, format: GPUTextureFormat) => {
    const texture = device.createTexture({
      label: BLOOM_PASS,
      size: { width, height },
      format,
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
    made.push(texture)
    return texture
  }
  const binding = { buffer: uniform, size: KERNEL_BYTES }
  let size: [number, number] = [source.width, source.height]
  let current = make(size[0], size[1], KERNEL_FORMAT)
  const hold = bindTo(device, programs.layouts.hold, [
    [0, binding],
    [1, source.createView()],
    [3, current.createView()],
  ])
  dispatchStage(encoder, programs.kernel.hold, hold, tiles(size[0]), tiles(size[1]))
  let passes = 1
  const reach = Math.max(Math.max(plan.image[0], plan.image[1]) * plan.support, 1)
  for (let factor = source.width / reach; factor > 2; factor *= 0.5, passes++) {
    const next: [number, number] = [Math.max(1, size[0] >> 1), Math.max(1, size[1] >> 1)]
    const halved = make(next[0], next[1], KERNEL_FORMAT)
    const group = bindTo(device, programs.layouts.halve, [
      [0, binding],
      [1, current.createView()],
      [2, programs.clamped],
      [3, halved.createView()],
    ])
    dispatchStage(encoder, programs.kernel.halve, group, tiles(next[0]), tiles(next[1]))
    current = halved
    size = next
  }
  const drawn = make(plan.frequency[0], plan.frequency[1], TRANSFORM_FORMAT)
  const resize = bindTo(device, programs.layouts.resize, [
    [0, binding],
    [1, current.createView()],
    [2, programs.wrapped],
    [4, drawn.createView()],
  ])
  const [across, down] = plan.frequency.map(tiles)
  dispatchStage(encoder, programs.kernel.resize, resize, across, down)
  return { drawn, passes: passes + 1 }
}

/** The transform of the prepared picture `drawn`, in `encoder`: its rows, then its columns, into the
 *  planes of half spectra at `spectrum`; the uniform is `uniform`, written here. */
function transformKernel(
  device: GPUDevice,
  programs: Programs,
  encoder: GPUCommandEncoder,
  uniform: GPUBuffer,
  plan: ConvolutionPlan,
  drawn: GPUTexture,
  spectrum: GPUBuffer,
) {
  const shape = transformShape(plan, true)
  const words = new Float32Array(FFT_PARAMS.words)
  writeTransformWords(words, shape, [1, 1, 1, 1])
  device.queue.writeBuffer(uniform, 0, words)
  const binding = { buffer: uniform, size: FFT_BYTES },
    planes = { buffer: spectrum },
    factors = { buffer: programs.twiddles }
  const { forward, columns } = programs.layouts
  const rows = bindTo(device, forward, [
    [0, binding],
    [1, drawn.createView()],
    [2, planes],
    [3, factors],
  ])
  // The kernel's own columns multiply by none: the last slot holds what is read-only already.
  const down = bindTo(device, columns, [
    [0, binding],
    [2, planes],
    [3, factors],
    [4, factors],
  ])
  dispatchStage(encoder, programs.transform.forwardRows, rows, shape.lines)
  dispatchStage(encoder, programs.transform.convolveColumns, down, shape.columns)
}

/** The kernel's picture on the device, uploaded once and made again when the kernel is another. */
function createKernelPicture(device: GPUDevice) {
  let held: { image: BloomKernelImage; texture: GPUTexture } | undefined
  const release = () => {
    if (held) retire(device, held.texture)
    held = undefined
  }
  return {
    /** The texture of `image`. */
    of(image: BloomKernelImage) {
      if (held?.image === image) return held.texture
      release()
      const [width, height] = [image.width, image.height]
      const texture = device.createTexture({
        label: BLOOM_PASS,
        size: { width, height },
        format: TRANSFORM_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      const pixels = image.pixels as Float32Array<ArrayBuffer>
      device.queue.writeTexture(
        { texture },
        pixels,
        { bytesPerRow: 16 * width, rowsPerImage: height },
        { width, height },
      )
      held = { image, texture }
      return texture
    },
    get bytes() {
      return held ? madeTextureBytes(held.texture) : 0
    },
    release,
  }
}

/**
 * THE KERNEL'S TRANSFORM, made at the first image that draws a convolution and kept while nothing
 * it depends on moves (`bloomCacheKernel`; off, it is made again at every image): the kernel's
 * picture uploaded once (`prepareKernel`, then `transformKernel`, in the frame's encoder). What the
 * passes need of the kernel — its centre, the haze, the light that stays and the light spread — is
 * read on the CPU (`analyseKernel`).
 */
export function createConvolutionKernel(device: GPUDevice) {
  const programs = convolutionPrograms(device)
  const [kernelUniform, fftUniform] = [KERNEL_BYTES, FFT_BYTES].map((size) =>
    device.createBuffer({
      label: BLOOM_PASS,
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
  )
  const picture = createKernelPicture(device)
  let held:
    | {
        image: BloomKernelImage
        plan: ConvolutionPlan
        buffer: GPUBuffer | undefined
        stats: KernelStats
        passes: number
      }
    | undefined
  // What `ensure` returns, rewritten by each image: an image allocates none.
  const reply = { buffer: undefined, passes: 0 } as KernelSpectrum
  const answer = (passes = 0) => {
    reply.buffer = held!.buffer
    reply.stats = held!.stats
    reply.passes = passes
    return reply
  }
  const dropSpectrum = () => {
    if (held?.buffer) retire(device, held.buffer)
    held = undefined
  }
  return {
    /** The kernel's transform for `image` of the plan's image, made in `encoder` unless the one held
     *  is still the one it needs and `cache` keeps it. */
    ensure(
      encoder: GPUCommandEncoder,
      plan: ConvolutionPlan,
      image: BloomKernelImage,
      cache: boolean,
    ): KernelSpectrum {
      if (cache && held && sameKey(held, image, plan)) return answer()
      dropSpectrum()
      const stats = analyseKernel(image, plan.image[0], plan.support)
      if (!stats.lit) {
        held = { image, plan, buffer: undefined, stats, passes: 0 }
        return answer()
      }
      writeKernelUniform(device, kernelUniform, plan, stats, image)
      const size = plan.bytes.kernel
      const buffer = device.createBuffer({ label: BLOOM_PASS, size, usage: GPUBufferUsage.STORAGE })
      const made: GPUTexture[] = []
      const source = picture.of(image)
      const { drawn, passes } = prepareKernel(
        device,
        programs,
        encoder,
        kernelUniform,
        plan,
        source,
        made,
      )
      transformKernel(device, programs, encoder, fftUniform, plan, drawn, buffer)
      for (const texture of made) retire(device, texture)
      held = { image, plan, buffer, stats, passes: passes + 2 }
      return answer(held.passes)
    },
    /** Bytes of the kernel's transform and of the kernel's picture. */
    get bytes() {
      return (held?.buffer?.size ?? 0) + picture.bytes
    },
    /** Gives the transform and the picture back, the uniforms too. */
    dispose() {
      dropSpectrum()
      picture.release()
      kernelUniform.destroy()
      fftUniform.destroy()
    },
  }
}
