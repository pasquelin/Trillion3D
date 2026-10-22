import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { preparedComputeStage } from '../../../../gpu/core/computeStages.ts'
import { preparedPipeline, fullscreenDescriptor } from '../../../../lighting/deferred/fullscreen.ts'
import { workgroupStorageBytes } from '../../../../gpu/core/textureLimits.ts'
import {
  computeBufferEntry,
  computeSamplerEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import { BLOOM_PASS } from '../../../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../../../scene/targetFormats.ts'
import { finishLayout } from '../../../finish/finishLayout.ts'
import { FFT_BYTES, FFT_LANES, fftShader } from './fftWgsl.ts'
import { KERNEL_BYTES, KERNEL_WGSL } from './kernelWgsl.ts'
import { CONVOLUTION_INPUT_BYTES, CONVOLUTION_INPUT_WGSL } from './inputWgsl.ts'
import { twiddleTable } from './twiddles.ts'

/** The format the transform reads its image in, and writes the kernel's resized picture in: four
 *  floats, as the transform's own values are. */
export const TRANSFORM_FORMAT: GPUTextureFormat = 'rgba32float'
/** The format the prepared kernel is held in: half floats, a picture the transform does not read. */
export const KERNEL_FORMAT: GPUTextureFormat = 'rgba16float'

/** The longest line a transform holds: the largest power of two that two floats a value fit in the
 *  workgroup memory of a device with `bytes`, 4096 at most — the reference's longest —, and no fewer
 *  than a workgroup's threads. */
export function longestLine(bytes: number) {
  let line = FFT_LANES
  while (line * 2 * 8 <= bytes && line < 4096) line *= 2
  return line
}

/** The layouts of the transform's three passes and the kernel's three (`convolutionPrograms`). */
function computeLayouts(device: GPUDevice) {
  const compute = (...entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ label: BLOOM_PASS, entries })
  const fftUniform = computeUniformEntry(0, { minBindingSize: FFT_BYTES })
  const kernelUniform = computeUniformEntry(0, { minBindingSize: KERNEL_BYTES })
  const [planes, factors] = [
    computeBufferEntry(2, 'storage'),
    computeBufferEntry(3, 'read-only-storage'),
  ]
  const [picture, sampled] = [
    computeTextureEntry(1, 'unfilterable-float'),
    computeTextureEntry(1, 'float'),
  ]
  return {
    forward: compute(fftUniform, picture, planes, factors),
    columns: compute(fftUniform, planes, factors, computeBufferEntry(4, 'read-only-storage')),
    inverse: compute(fftUniform, planes, factors, computeStorageTextureEntry(5, HDR_FORMAT)),
    hold: compute(kernelUniform, picture, computeStorageTextureEntry(3, KERNEL_FORMAT)),
    halve: compute(
      kernelUniform,
      sampled,
      computeSamplerEntry(2),
      computeStorageTextureEntry(3, KERNEL_FORMAT),
    ),
    resize: compute(
      kernelUniform,
      sampled,
      computeSamplerEntry(2),
      computeStorageTextureEntry(4, TRANSFORM_FORMAT),
    ),
  }
}

/** The render pass that draws the image the transform reads: its layout, its pipeline. */
function inputPass(device: GPUDevice) {
  const fragment = GPUShaderStage.FRAGMENT
  const layout = device.createBindGroupLayout({
    label: BLOOM_PASS,
    entries: [
      computeTextureEntry(0, 'float', '2d', fragment),
      computeSamplerEntry(1, 'filtering', fragment),
      computeUniformEntry(2, { minBindingSize: CONVOLUTION_INPUT_BYTES }, fragment),
    ],
  })
  const module = device.createShaderModule({ label: BLOOM_PASS, code: CONVOLUTION_INPUT_WGSL })
  const targets = [{ format: TRANSFORM_FORMAT }]
  const label = `${BLOOM_PASS} input`
  const descriptor = fullscreenDescriptor(
    device,
    module,
    [layout, finishLayout(device)],
    'convolutionInput',
    targets,
    label,
  )
  return { layout, pipeline: preparedPipeline(device, descriptor) }
}

/** The table of the transform's factors on the device, for lines of `maxLine` values. */
function factorsBuffer(device: GPUDevice, maxLine: number) {
  const table = twiddleTable(maxLine)
  const buffer = device.createBuffer({
    label: BLOOM_PASS,
    size: table.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, table)
  return buffer
}

/**
 * THE CONVOLUTION'S PROGRAMS once a device, prepared off the thread when the first image that draws
 * one asks (`askConvolutionPrograms`), none made before: the three passes of the transform and the
 * three of the kernel's preparation, compute stages by entry point; the image the transform reads, a
 * render pass; the layouts of their groups, the samplers they read the kernel and the
 * glow through, the table of the transform's factors, and the longest line the device transforms.
 */
export const convolutionPrograms = oncePerDevice((device: GPUDevice) => {
  const maxLine = longestLine(workgroupStorageBytes(device.limits))
  const layouts = computeLayouts(device)
  const stage = (module: GPUShaderModule, layout: GPUBindGroupLayout, entry: string) =>
    preparedComputeStage(
      device,
      device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      module,
      entry,
      undefined,
      `${BLOOM_PASS} ${entry}`,
    )
  const fft = device.createShaderModule({ label: BLOOM_PASS, code: fftShader(maxLine) })
  const kernel = device.createShaderModule({ label: BLOOM_PASS, code: KERNEL_WGSL })
  const input = inputPass(device)
  const sampler = (mode: GPUAddressMode) =>
    device.createSampler({
      label: BLOOM_PASS,
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: mode,
      addressModeV: mode,
    })
  return {
    maxLine,
    layouts: { ...layouts, input: input.layout },
    transform: {
      forwardRows: stage(fft, layouts.forward, 'forwardRows'),
      convolveColumns: stage(fft, layouts.columns, 'convolveColumns'),
      inverseRows: stage(fft, layouts.inverse, 'inverseRows'),
    },
    kernel: {
      hold: stage(kernel, layouts.hold, 'holdKernel'),
      halve: stage(kernel, layouts.halve, 'halveKernel'),
      resize: stage(kernel, layouts.resize, 'resizeKernel'),
    },
    input: input.pipeline,
    twiddles: factorsBuffer(device, maxLine),
    /** Bilinear, clamping to the edge, and wrapping around it. */
    clamped: sampler('clamp-to-edge'),
    wrapped: sampler('repeat'),
  }
})

/** A bind group of `layout` naming each resource at its binding. */
export const bindTo = (
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  entries: readonly (readonly [number, GPUBindingResource])[],
) =>
  device.createBindGroup({
    layout,
    entries: entries.map(([binding, resource]) => ({ binding, resource })),
  })

/** Runs `stage` once on `group`, over `x` × `y` workgroups, in a compute pass of its own. */
export function dispatchStage(
  encoder: GPUCommandEncoder,
  stage: { get(): GPUComputePipeline },
  group: GPUBindGroup,
  x: number,
  y = 1,
) {
  const pass = encoder.beginComputePass({ label: BLOOM_PASS })
  pass.setPipeline(stage.get())
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(x, y)
  pass.end()
}

/** Asks the convolution's programs of `device` off the thread, the frames held until they landed
 *  (`../../../../frame/loop/framePipelines.ts`). */
export function askConvolutionPrograms(device: GPUDevice) {
  const { transform, kernel, input } = convolutionPrograms(device)
  for (const program of [...Object.values(transform), ...Object.values(kernel), input])
    program.ask()
}
