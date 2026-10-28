/**
 * THE CHANGE OF EACH LIGHT'S POWER, run once an image before the sampled lighting needs it (`powerDeltaWgsl.ts`): the power of the lights of this image and of the image before (ping-pong), the pre-exposure
 * that power was measured under, and the ratios the draws of the surfaces and of the volume read (`encode` returns their buffer). Idempotent for an image.
 */
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { computeBufferEntry, computeUniformEntry } from '../../gpu/core/computeBindings.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { lightFunctionLayoutEntry } from '../lightFunction/bindings.ts'
import {
  POWER_BINDING,
  POWER_DELTA_ENTRY,
  POWER_DELTA_THREADS,
  POWER_FRAME_WORDS,
  powerDeltaWgsl,
} from './powerDeltaWgsl.ts'

/** What an image gives the power pass. */
export interface LightPowerImage {
  image: number
  lights: GPUBuffer
  lightCount: number
  lightFunction: GPUTextureView
  eye: ArrayLike<number>
  preExposure: number
  exposure: number
  /** `sampledLightsPowerDelta` and `sampledLightsPowerDeltaLightFunctions`. */
  measured: boolean
  lightFunctions: boolean
}

function createPowerLayout(device: GPUDevice) {
  return device.createBindGroupLayout({
    entries: [
      computeUniformEntry(POWER_BINDING.frame),
      computeBufferEntry(POWER_BINDING.lights, 'read-only-storage'),
      lightFunctionLayoutEntry(POWER_BINDING.atlas),
      computeBufferEntry(POWER_BINDING.before, 'read-only-storage'),
      computeBufferEntry(POWER_BINDING.now, 'storage'),
      computeBufferEntry(POWER_BINDING.ratios, 'storage'),
      computeBufferEntry(POWER_BINDING.exposureBefore, 'read-only-storage'),
    ],
  })
}

/** The frame uniform of an image: the eye, the exposures and the switches. */
function powerFrameWords(input: LightPowerImage, valid: boolean) {
  const words = new ArrayBuffer(POWER_FRAME_WORDS * 4)
  new Float32Array(words).set([
    input.eye[0]!,
    input.eye[1]!,
    input.eye[2]!,
    1,
    input.preExposure,
    input.exposure,
    0,
    0,
  ])
  new Uint32Array(words).set(
    [input.measured ? 1 : 0, valid ? 1 : 0, input.lightFunctions ? 1 : 0, 0],
    8,
  )
  return words
}

/** The bind group of an image: the lights, the power before and now, the ratios and the exposure before. */
function powerGroup(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  held: {
    frame: GPUBuffer
    input: LightPowerImage
    before: GPUBuffer
    now: GPUBuffer
    ratios: GPUBuffer
    exposureBefore: GPUBuffer
  },
) {
  return device.createBindGroup({
    label: 'Trillion3D sampled light power',
    layout,
    entries: [
      { binding: POWER_BINDING.frame, resource: { buffer: held.frame } },
      { binding: POWER_BINDING.lights, resource: { buffer: held.input.lights } },
      { binding: POWER_BINDING.atlas, resource: held.input.lightFunction },
      { binding: POWER_BINDING.before, resource: { buffer: held.before } },
      { binding: POWER_BINDING.now, resource: { buffer: held.now } },
      { binding: POWER_BINDING.ratios, resource: { buffer: held.ratios } },
      { binding: POWER_BINDING.exposureBefore, resource: { buffer: held.exposureBefore } },
    ],
  })
}

/** The two buffers of power the images take turns with, and the buffer of ratios, of `capacity` lights. */
function createPowerBuffers(device: GPUDevice, capacity: number) {
  return {
    power: [0, 1].map((i) =>
      device.createBuffer({
        label: `Trillion3D sampled light power ${i}`,
        size: capacity * 4,
        usage: GPUBufferUsage.STORAGE,
      }),
    ),
    ratios: device.createBuffer({
      label: 'Trillion3D sampled light power ratios',
      size: capacity * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    }),
  }
}

/** The pass that measures the change of the power of each light, a thread each. */
function dispatchPower(
  encoder: GPUCommandEncoder,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  lightCount: number,
) {
  const pass = encoder.beginComputePass({ label: 'Trillion3D sampled light power' })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, group)
  pass.dispatchWorkgroups(Math.max(1, ceilDiv(lightCount, POWER_DELTA_THREADS)))
  pass.end()
}

export function createLightPower(device: GPUDevice, failed: (error: unknown) => void) {
  const layout = createPowerLayout(device)
  const stage = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    device.createShaderModule({ label: 'Trillion3D sampled light power', code: powerDeltaWgsl() }),
    POWER_DELTA_ENTRY,
    undefined,
    'Trillion3D sampled light power',
  ).ask()
  stage.prepare().catch(failed)
  const frame = device.createBuffer({
    label: 'Trillion3D sampled light power frame',
    size: POWER_FRAME_WORDS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const exposures = [0, 1].map((i) =>
    device.createBuffer({
      label: `Trillion3D sampled light power exposure ${i}`,
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
  )
  let capacity = 0
  let power: GPUBuffer[] = []
  let ratios: GPUBuffer | undefined
  let turn = 0
  let lastImage = -2
  let done = -1
  const release = () => {
    for (const buffer of [...power, ...(ratios ? [ratios] : [])]) retire(device, buffer)
    power = []
    ratios = undefined
    capacity = 0
  }
  return {
    /** The buffer of the ratios (one 32-bit float per light, as words) of this image, none while the pass compiles. */
    encode(encoder: GPUCommandEncoder, input: LightPowerImage): GPUBuffer | undefined {
      if (done === input.image && ratios) return ratios
      const pipeline = stage.get()
      if (!pipeline) return undefined
      let valid = lastImage === input.image - 1 && input.measured
      if (input.lightCount > capacity) {
        release()
        capacity = Math.max(input.lightCount, 16)
        const made = createPowerBuffers(device, capacity)
        power = made.power
        ratios = made.ratios
        valid = false
      }
      lastImage = input.image
      done = input.image
      turn ^= 1
      const words = powerFrameWords(input, valid)
      device.queue.writeBuffer(frame, 0, words)
      // The pre-exposure the power of this image is measured under is the next image's 'before'.
      device.queue.writeBuffer(exposures[turn]!, 0, new Float32Array([input.preExposure]))
      const group = powerGroup(device, layout, {
        frame,
        input,
        before: power[turn ^ 1]!,
        now: power[turn]!,
        ratios: ratios!,
        exposureBefore: exposures[turn ^ 1]!,
      })
      dispatchPower(encoder, pipeline, group, input.lightCount)
      return ratios
    },
    dispose() {
      release()
      frame.destroy()
      for (const buffer of exposures) buffer.destroy()
    },
  }
}
