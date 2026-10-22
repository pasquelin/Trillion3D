import { oncePerDevice } from '../../../../gpu/core/oncePerDevice.ts'
import { postSamplers } from '../../../../gpu/core/postSamplers.ts'
import { preparedComputeStage } from '../../../../gpu/core/computeStages.ts'
import { preparedPipeline, fullscreenDescriptor } from '../../../../lighting/deferred/fullscreen.ts'
import { textureLimits, workgroupStorageBytes } from '../../../../gpu/core/textureLimits.ts'
import { storageBufferCap } from '../../../../session/memory/pools.ts'
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
import { FFT_BINDINGS, FFT_BYTES, FFT_LANES, fftShader } from './fftWgsl.ts'
import {
  KERNEL_BINDINGS,
  KERNEL_BYTES,
  KERNEL_FORMAT,
  KERNEL_WGSL,
  RESIZED_FORMAT,
} from './kernelWgsl.ts'
import { CONVOLUTION_INPUT_BYTES, CONVOLUTION_INPUT_WGSL, INPUT_BINDINGS } from './inputWgsl.ts'
import { planConvolution, type ConvolutionPlan } from './plan.ts'
import { twiddleTable } from './twiddles.ts'

/** The longest line a transform holds: the largest power of two that two floats a value fit in the
 *  workgroup memory of a device with `bytes`, 4096 at most — the reference's longest —, and no fewer
 *  than a workgroup's threads. */
function longestLine(bytes: number) {
  let line = FFT_LANES
  while (line * 2 * 8 <= bytes && line < 4096) line *= 2
  return line
}

/** The layouts of the transform's three passes and the kernel's three (`convolutionPrograms`). */
function computeLayouts(device: GPUDevice) {
  const compute = (...entries: GPUBindGroupLayoutEntry[]) =>
    device.createBindGroupLayout({ label: BLOOM_PASS, entries })
  const [f, k] = [FFT_BINDINGS, KERNEL_BINDINGS]
  const fftUniform = computeUniformEntry(f.params, { minBindingSize: FFT_BYTES })
  const kernelUniform = computeUniformEntry(k.params, { minBindingSize: KERNEL_BYTES })
  const [planes, factors] = [
    computeBufferEntry(f.planes, 'storage'),
    computeBufferEntry(f.factors, 'read-only-storage'),
  ]
  const picture = computeTextureEntry(f.source, 'unfilterable-float')
  const held = computeStorageTextureEntry(k.held, KERNEL_FORMAT)
  const sampled = [computeTextureEntry(k.source, 'float'), computeSamplerEntry(k.reader)]
  return {
    forward: compute(fftUniform, picture, planes, factors),
    columns: compute(
      fftUniform,
      planes,
      factors,
      computeBufferEntry(f.kernel, 'read-only-storage'),
    ),
    inverse: compute(fftUniform, planes, factors, computeStorageTextureEntry(f.glow, HDR_FORMAT)),
    hold: compute(kernelUniform, computeTextureEntry(k.source, 'unfilterable-float'), held),
    halve: compute(kernelUniform, ...sampled, held),
    resize: compute(kernelUniform, ...sampled, computeStorageTextureEntry(k.drawn, RESIZED_FORMAT)),
  }
}

/** The render pass that draws the image the transform reads where the level is not it: its layout,
 *  its pipeline, an image of the chain's own format. */
function inputPass(device: GPUDevice) {
  const fragment = GPUShaderStage.FRAGMENT
  const b = INPUT_BINDINGS
  const layout = device.createBindGroupLayout({
    label: BLOOM_PASS,
    entries: [
      computeTextureEntry(b.image, 'float', '2d', fragment),
      computeSamplerEntry(b.reader, 'filtering', fragment),
      computeUniformEntry(b.params, { minBindingSize: CONVOLUTION_INPUT_BYTES }, fragment),
    ],
  })
  const module = device.createShaderModule({ label: BLOOM_PASS, code: CONVOLUTION_INPUT_WGSL })
  const label = `${BLOOM_PASS} input`
  const descriptor = fullscreenDescriptor(
    device,
    module,
    [layout, finishLayout(device)],
    'convolutionInput',
    [{ format: HDR_FORMAT }],
    label,
  )
  return { layout, pipeline: preparedPipeline(device, descriptor) }
}

/** The table of the transform's factors on the device, for lines of `line` values. */
function factorsBuffer(device: GPUDevice, line: number) {
  const table = twiddleTable(line)
  const buffer = device.createBuffer({
    label: BLOOM_PASS,
    size: table.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, table)
  return buffer
}

/** The line a plan's transform is made for: the longer of its two sides, no shorter than a workgroup's
 *  threads. Both are powers of two, so is it. */
export const transformLineOf = (plan: ConvolutionPlan) =>
  Math.max(FFT_LANES, plan.frequency[0], plan.frequency[1])

/** The transform of one line length (`createTransforms`): its three stages and the table of factors
 *  they read, `ready` once every stage is compiled. */
export interface ConvolutionTransform {
  readonly stages: {
    forwardRows: ReturnType<typeof preparedComputeStage>
    convolveColumns: ReturnType<typeof preparedComputeStage>
    inverseRows: ReturnType<typeof preparedComputeStage>
  }
  readonly twiddles: GPUBuffer
  readonly ready: boolean
}

/** The compiles of transforms in flight on each device, apart from the programs: whoever waits on them
 *  (`convolutionArriving`) must not make the programs to ask. */
const COMPILING = new WeakMap<GPUDevice, Set<Promise<void>>>()
const pendingOf = (device: GPUDevice) => {
  let pending = COMPILING.get(device)
  if (!pending) COMPILING.set(device, (pending = new Set()))
  return pending
}

/** The compile of a transform in flight on `device`, none when none is: the bloom's `arriving`, so the
 *  image drawn meanwhile is drawn again once it landed. */
export function convolutionArriving(device: GPUDevice) {
  const pending = COMPILING.get(device)
  return pending?.size ? Promise.all([...pending]).then(() => undefined) : undefined
}

/**
 * THE TRANSFORM'S PROGRAMS BY LINE LENGTH, each made at its first ask: a transform holds a line in
 * workgroup memory, so the program is made for the line it transforms — a line of 1024 values holds
 * 8 KiB where the device's longest holds 16 or 32 —, with the table of factors for it. `of(line)`
 * asks the device for its three stages (the frames held on them, `arriving` the compile in flight)
 * and says whether they are compiled; `convolutionArriving` is the compile in flight.
 */
function createTransforms(
  device: GPUDevice,
  layouts: ReturnType<typeof computeLayouts>,
  stage: (module: GPUShaderModule, layout: GPUBindGroupLayout, entry: string) => PreparedStage,
) {
  const made = new Map<number, ConvolutionTransform>()
  const pending = pendingOf(device)
  return {
    of(line: number) {
      let transform = made.get(line)
      if (!transform) {
        const module = device.createShaderModule({ label: BLOOM_PASS, code: fftShader(line) })
        const stages = {
          forwardRows: stage(module, layouts.forward, 'forwardRows'),
          convolveColumns: stage(module, layouts.columns, 'convolveColumns'),
          inverseRows: stage(module, layouts.inverse, 'inverseRows'),
        }
        made.set(
          line,
          (transform = {
            stages,
            twiddles: factorsBuffer(device, line),
            get ready() {
              return (
                stages.forwardRows.ready && stages.convolveColumns.ready && stages.inverseRows.ready
              )
            },
          }),
        )
      }
      if (!transform.ready) {
        const compiles = Object.values(transform.stages).map((program) => program.ask().prepare())
        const compiling = Promise.all(compiles).then(
          () => void pending.delete(compiling),
          () => void pending.delete(compiling),
        )
        pending.add(compiling)
      }
      return transform
    },
  }
}
type PreparedStage = ReturnType<typeof preparedComputeStage>

/**
 * THE CONVOLUTION'S PROGRAMS once a device, prepared off the thread when the first image that draws
 * one asks (`askConvolutionPrograms`), none made before: the three passes of the kernel's
 * preparation, compute stages by entry point; the image the transform reads, a render pass; the
 * layouts of their groups, the samplers they read the kernel and the glow through, the longest line
 * the device transforms, and the transforms by line length (`createTransforms`).
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
  const kernel = device.createShaderModule({ label: BLOOM_PASS, code: KERNEL_WGSL })
  const input = inputPass(device)
  return {
    maxLine,
    layouts: { ...layouts, input: input.layout },
    transforms: createTransforms(device, layouts, stage),
    kernel: {
      hold: stage(kernel, layouts.hold, 'holdKernel'),
      halve: stage(kernel, layouts.halve, 'halveKernel'),
      resize: stage(kernel, layouts.resize, 'resizeKernel'),
    },
    input: input.pipeline,
    /** Bilinear, clamping to the edge, and wrapping around it (`postSamplers`). */
    clamped: postSamplers(device).clamped,
    wrapped: postSamplers(device).wrapped,
  }
})

/** What bounds a transform on `device`: the widest texture, the longest line the workgroup memory
 *  holds and the most bytes a storage buffer binds — each of the spectra is one. */
export function convolutionLimits(device: GPUDevice, programs = convolutionPrograms(device)) {
  return {
    side: textureLimits(device.limits).side,
    maxLine: programs.maxLine,
    bytes: storageBufferCap(device.limits),
  }
}

/**
 * Asks the convolution's programs of `device` off the thread, the frames held until they landed
 * (`../../../../frame/loop/framePipelines.ts`): the kernel's, the input's and the transforms for the
 * lines a convolution of `conv` at `percent` of an image of each of `sizes` transforms — the sizes
 * the chain draws at; an image of another size asks its own when it draws.
 */
export function askConvolutionPrograms(
  device: GPUDevice,
  sizes: readonly (readonly number[])[],
  percent: number,
  conv: { size: number; bufferScale: number },
) {
  const programs = convolutionPrograms(device)
  const limits = convolutionLimits(device, programs)
  for (const program of [...Object.values(programs.kernel), programs.input]) program.ask()
  for (const view of sizes) {
    if (view[0] < 1 || view[1] < 1) continue
    const ask = { view, percent, size: conv.size, bufferScale: conv.bufferScale }
    programs.transforms.of(transformLineOf(planConvolution(ask, limits)))
  }
}
