import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { CAPTURE_FLOATS } from './captureWgsl.ts'
import { airGroupsOver, type AirGroups } from './bindings.ts'
import {
  AERIAL_VOLUME,
  MULTISCATTERING_LUT,
  SKY_RAYS,
  SKY_VIEW_LUT,
  TRANSMITTANCE_LUT,
} from './layout.ts'
import type { AirResources } from './resources.ts'

/** What an image tells the air's passes: the light buffer they read and write, the versions of the
 *  air and of the air with its sun, and the image's frame (`writeAirFrame`). */
export interface AirInputs {
  buffer: GPUBuffer
  version: number
  epoch: number
  frame: Float32Array<ArrayBuffer>
}

/** Groups of `size` threads that cover `n` texels. */
const groups = (n: number, size = 8) => ceilDiv(n, size)

type Step = AirResources['passes'][keyof AirResources['passes']]

/** Dispatches `step` over `bound`, `x` by `y` by `z` groups. */
function run(
  pass: GPUComputePassEncoder,
  step: Step,
  bound: GPUBindGroup,
  x: number,
  y = 1,
  z = 1,
) {
  pass.setPipeline(step.pipeline.get())
  pass.setBindGroup(0, bound)
  pass.dispatchWorkgroups(x, y, z)
}

/** The air's tables (`rebuild`: the air changed), then the sky around the eye and the haze volume,
 *  which every image builds. */
function encodeImageTables(
  pass: GPUComputePassEncoder,
  { passes }: AirResources,
  over: AirGroups,
  rebuild: boolean,
) {
  if (rebuild) {
    run(
      pass,
      passes.transmittance,
      over.transmittance,
      groups(TRANSMITTANCE_LUT.width),
      groups(TRANSMITTANCE_LUT.height),
    )
    run(
      pass,
      passes.multiScatter,
      over.multiScatter,
      groups(MULTISCATTERING_LUT.width),
      groups(MULTISCATTERING_LUT.height),
    )
  }
  run(pass, passes.skyView, over.skyView, groups(SKY_VIEW_LUT.width), groups(SKY_VIEW_LUT.height))
  run(
    pass,
    passes.haze,
    over.haze,
    groups(AERIAL_VOLUME.width, 4),
    groups(AERIAL_VOLUME.height, 4),
    groups(AERIAL_VOLUME.slices, 4),
  )
}

/**
 * THE AIR'S WORK PER IMAGE, and what it remembers of the images before: the versions it built the
 * tables for, the sun's epoch the sky by direction was built for and the one the sky was summed
 * for, the light buffer the sky by direction was built into, and how many times it was.
 *
 * The air alone — its coefficients — builds the transmittance and the multiple-scattering tables,
 * once and again only when it is set. The image builds the sky table around the eye and the haze
 * volume, small, every image. The sun or the air moving builds the sky by direction once, and sums
 * the sky into the harmonics of the sky light, once, copied to a staging buffer of the ring when
 * one is free: a sum that waits for a buffer does not build the sky again.
 */
export function createAirEncoder(device: GPUDevice, resources: AirResources) {
  const { passes, frameBuffer, captureBuffer, ring } = resources
  let over: AirGroups | undefined
  let builtVersion = -1,
    builtEpoch = -1,
    summedEpoch = -1,
    skyBuilds = 0,
    skyBuffer: GPUBuffer | undefined
  const computeDescriptor: GPUComputePassDescriptor = { label: 'Trillion3D air' }
  return {
    /** The groups over the light buffer of the last image, none before the first. */
    get groups() {
      return over
    },
    /** How many times the sky by direction was built — the sun, the air or the light buffer
     *  changed —, counted as its pass is encoded. */
    get skyBuilds() {
      return skyBuilds
    },
    /** The tables and the volume of this image, built on `encoder`, and the copy of the harmonics. */
    encode(encoder: GPUCommandEncoder, inputs: AirInputs) {
      if (over?.buffer !== inputs.buffer) over = airGroupsOver(resources, inputs.buffer)
      device.queue.writeBuffer(frameBuffer, 0, inputs.frame)
      const pass = encoder.beginComputePass(computeDescriptor)
      const rebuild = builtVersion !== inputs.version
      builtVersion = inputs.version
      encodeImageTables(pass, resources, over, rebuild)
      if (builtEpoch !== inputs.epoch || skyBuffer !== inputs.buffer) {
        builtEpoch = inputs.epoch
        skyBuffer = inputs.buffer
        run(pass, passes.distantSky, over.distantSky, 1)
        run(
          pass,
          passes.skyRays,
          over.skyRays,
          groups(SKY_RAYS.azimuth),
          groups(SKY_RAYS.elevation),
        )
        skyBuilds++
      }
      const staging = summedEpoch !== inputs.epoch ? ring.take() : undefined
      if (staging) {
        summedEpoch = inputs.epoch
        run(pass, passes.capture, over.capture, 1)
      }
      pass.end()
      if (staging) encoder.copyBufferToBuffer(captureBuffer, 0, staging, 0, CAPTURE_FLOATS * 4)
    },
  }
}
