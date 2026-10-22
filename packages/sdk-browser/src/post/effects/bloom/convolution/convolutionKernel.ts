import type { BloomKernelImage } from '../../../../../../sdk-core/src/contracts/bloomConvolutionOptions.ts'
import { ceilDiv, mipSize } from '../../../../../../math/src/scalar/integers.ts'
import { namedGroup } from '../../../../gpu/core/computeBindings.ts'
import { retire } from '../../../../gpu/core/frameRetire.ts'
import { dispatchOn } from '../../../../gpu/core/computeStages.ts'
import { uniformBlock, type UniformBlock } from '../../../../gpu/core/uniformBlock.ts'
import { BLOOM_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import { FFT_BINDINGS, FFT_BYTES } from './fftWgsl.ts'
import {
  KERNEL_BINDINGS,
  KERNEL_BYTES,
  KERNEL_FORMAT,
  KERNEL_PARAMS,
  KERNEL_TILE,
  RESIZED_FORMAT,
} from './kernelWgsl.ts'
import { convolutionPrograms, transformLineOf } from './convolutionPrograms.ts'
import { createSpectrumSlot, type KernelSpectrum } from './kernelHeld.ts'
import { analyseKernel, type KernelStats } from './kernelStats.ts'
import { createTransients, type KernelTransients } from './kernelTransients.ts'
import type { ConvolutionPlan } from './plan.ts'
import { writeTransformWords } from './transformShape.ts'

const tiles = (n: number) => ceilDiv(n, KERNEL_TILE)

type Programs = ReturnType<typeof convolutionPrograms>

/** The uniform of the kernel's passes (`KERNEL_PARAMS`), written for the kernel `image` and the plan. */
function writeKernelUniform(
  { words, send }: UniformBlock,
  plan: ConvolutionPlan,
  stats: KernelStats,
  image: BloomKernelImage,
) {
  const at = KERNEL_PARAMS.at
  words.f.set(stats.maxScatter, at.limit)
  words.u.set([plan.frequency[0], plan.frequency[1], 0, 0], at.dst)
  words.u.set([plan.image[0], plan.image[1], stats.centre[0], stats.centre[1]], at.image)
  words.f.set([1 / image.width, 1 / image.height, plan.support, 0], at.scale)
  send()
}

/**
 * The kernel prepared for the transform, in the compute pass `pass`: held to the haze beside its
 * centre, halved while it is more than twice the size it has over the image, then drawn at that size
 * in the transform's square about its centre. `source` is the kernel's picture, `transients` where
 * the images are made. Returns the picture drawn.
 */
function prepareKernel(
  device: GPUDevice,
  programs: Programs,
  pass: GPUComputePassEncoder,
  uniform: GPUBuffer,
  plan: ConvolutionPlan,
  source: GPUTexture,
  transients: KernelTransients,
) {
  const params = { buffer: uniform, size: KERNEL_BYTES }
  const group = (layout: GPUBindGroupLayout, resources: Parameters<typeof namedGroup>[3]) =>
    namedGroup(device, layout, KERNEL_BINDINGS, resources)
  let size: [number, number] = [source.width, source.height]
  let current = transients.image(size[0], size[1], KERNEL_FORMAT)
  const hold = group(programs.layouts.hold, {
    params,
    source: source.createView(),
    held: current.createView(),
  })
  dispatchOn(pass, programs.kernel.hold, hold, tiles(size[0]), tiles(size[1]))
  const reach = Math.max(Math.max(plan.image[0], plan.image[1]) * plan.support, 1)
  for (let factor = source.width / reach; factor > 2; factor *= 0.5) {
    const next: [number, number] = [mipSize(size[0], 1), mipSize(size[1], 1)]
    const halved = transients.image(next[0], next[1], KERNEL_FORMAT)
    const halve = group(programs.layouts.halve, {
      params,
      source: current.createView(),
      reader: programs.clamped,
      held: halved.createView(),
    })
    dispatchOn(pass, programs.kernel.halve, halve, tiles(next[0]), tiles(next[1]))
    current = halved
    size = next
  }
  const drawn = transients.image(plan.frequency[0], plan.frequency[1], RESIZED_FORMAT)
  const resize = group(programs.layouts.resize, {
    params,
    source: current.createView(),
    reader: programs.wrapped,
    drawn: drawn.createView(),
  })
  const [across, down] = plan.frequency.map(tiles)
  dispatchOn(pass, programs.kernel.resize, resize, across, down)
  return drawn
}

/** The transform of the prepared picture `drawn`, in the compute pass `pass`: its rows, then its columns,
 *  into the planes of half spectra at `spectrum`, by the programs of the line `transform` is made for; the
 *  uniform is `uniform`, written here. */
function transformKernel(
  device: GPUDevice,
  programs: Programs,
  pass: GPUComputePassEncoder,
  uniform: UniformBlock,
  plan: ConvolutionPlan,
  drawn: GPUTexture,
  spectrum: GPUBuffer,
) {
  const shape = plan.shapes.kernel
  const transform = programs.transforms.of(transformLineOf(plan))
  writeTransformWords(uniform.words, shape, [1, 1, 1, 1])
  uniform.send()
  const params = { buffer: uniform.buffer, size: FFT_BYTES },
    planes = { buffer: spectrum },
    factors = { buffer: transform.twiddles }
  const group = (layout: GPUBindGroupLayout, resources: Parameters<typeof namedGroup>[3]) =>
    namedGroup(device, layout, FFT_BINDINGS, resources)
  const rows = group(programs.layouts.forward, {
    params,
    source: drawn.createView(),
    planes,
    factors,
  })
  // The kernel's own columns multiply by none: the last slot holds what is read-only already.
  const down = group(programs.layouts.columns, { params, planes, factors, kernel: factors })
  dispatchOn(pass, transform.stages.forwardRows, rows, shape.lines)
  dispatchOn(pass, transform.stages.convolveColumns, down, shape.columns)
}

/**
 * THE KERNEL'S TRANSFORM, made at the first image that draws a convolution and kept while nothing
 * it depends on moves (`bloomCacheKernel`; off, it is made again at every image, through the
 * textures and the buffer it kept): the kernel's picture uploaded for each rebuild and given back
 * with the rest of what the rebuild drew through (`prepareKernel`, then `transformKernel`, in one
 * compute pass of the frame's encoder). What the passes need of the kernel — its centre, the haze, the light that stays
 * and the light spread — is read on the CPU (`analyseKernel`).
 */
export function createConvolutionKernel(device: GPUDevice) {
  const programs = convolutionPrograms(device)
  const kernelUniform = uniformBlock(device, BLOOM_PASS, KERNEL_BYTES)
  const fftUniform = uniformBlock(device, BLOOM_PASS, FFT_BYTES)
  const transients = createTransients(device)
  const slot = createSpectrumSlot(device)
  return {
    /** The kernel's transform for `image` of the plan's image, made in `encoder` unless the one held
     *  is still the one it needs and `cache` keeps it. */
    ensure(
      encoder: GPUCommandEncoder,
      plan: ConvolutionPlan,
      image: BloomKernelImage,
      cache: boolean,
    ): KernelSpectrum {
      const held = slot.holds(image, plan)
      if (cache && held) return slot.answer(false)
      const stats = held ? slot.stats : analyseKernel(image, plan.image[0], plan.support)
      if (!stats.lit) {
        slot.keep(image, plan, undefined, stats, 0)
        return slot.answer(true)
      }
      writeKernelUniform(kernelUniform, plan, stats, image)
      const buffer = slot.bufferOf(plan.bytes.kernel)
      transients.begin()
      const source = transients.picture(image)
      const pass = encoder.beginComputePass({ label: BLOOM_PASS })
      const params = kernelUniform.buffer
      const drawn = prepareKernel(device, programs, pass, params, plan, source, transients)
      transformKernel(device, programs, pass, fftUniform, plan, drawn, buffer)
      pass.end()
      if (cache) transients.release()
      else transients.end()
      slot.keep(image, plan, buffer, stats, 1)
      return slot.answer(true)
    },
    /** Bytes of the kernel's transform and of the textures kept for the next rebuild. */
    get bytes() {
      return slot.bytes + transients.bytes
    },
    /** Gives the transform and the textures back, the uniforms too, retired with the frame that
     *  may still name them. */
    dispose() {
      slot.drop()
      transients.release()
      retire(device, kernelUniform.buffer)
      retire(device, fftUniform.buffer)
    },
  }
}
