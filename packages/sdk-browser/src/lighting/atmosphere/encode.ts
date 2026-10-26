import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  airGroupsOver,
  sameCloudShadow,
  sameShadowMaps,
  type AirGroups,
  type AirShadowMaps,
} from './bindings.ts'
import type { CloudShadowSet } from './cloudShadowRead.ts'
import { PUBLISHED_TRANSMITTANCE } from './layout.ts'
import type { AirPass, AirResources } from './resources.ts'

/** What an image tells the air's passes: the light buffer they read and write, the version of the
 *  air, the image's frame (`writeAirFrame`), the shadow maps the air's lights shade it with, and
 *  whether the clouds ask for the haze's light and the air's apart and for the haze around the
 *  capture's place. */
export interface AirInputs {
  buffer: GPUBuffer
  version: number
  frame: Float32Array<ArrayBuffer>
  maps: AirShadowMaps
  /** The clouds' shade the air's lights are read through; none: the resources' stand-in. */
  cloudShadow?: CloudShadowSet
  separate: boolean
  capture360: boolean
}

/** Groups of `size` threads that cover `n` texels. */
const groups = (n: number, size = 8) => ceilDiv(n, size)

/** The groups that cover the published transmittance's texels. */
const PUBLISHED_GROUPS = [
  groups(PUBLISHED_TRANSMITTANCE.width),
  groups(PUBLISHED_TRANSMITTANCE.height),
] as const

/** Dispatches `step` over `bound`, `x` by `y` by `z` groups. */
function run(
  pass: GPUComputePassEncoder,
  step: AirPass,
  bound: GPUBindGroup,
  x: number,
  y = 1,
  z = 1,
) {
  const pipeline = step.pipeline.get()
  if (!pipeline) return
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bound)
  pass.dispatchWorkgroups(x, y, z)
}

/** The air's tables (`rebuild`: the air changed), then the sky around the eye and the haze volume
 *  (and the volumes the clouds ask for), which every image builds. */
function encodeImageTables(
  pass: GPUComputePassEncoder,
  resources: AirResources,
  over: AirGroups,
  inputs: AirInputs,
  rebuild: boolean,
) {
  const { shape } = resources
  const { transmittance, multiScatter, skyView, aerial } = shape
  if (rebuild) {
    if (over.transmittance)
      run(
        pass,
        resources.pass('transmittance'),
        over.transmittance,
        groups(transmittance.width),
        groups(transmittance.height),
      )
    run(
      pass,
      resources.pass('multiScatter'),
      over.multiScatter,
      groups(multiScatter.width),
      groups(multiScatter.height),
    )
    run(pass, resources.pass('publish'), over.publish, ...PUBLISHED_GROUPS)
  }
  run(pass, resources.pass('skyView'), over.skyView, groups(skyView.width), groups(skyView.height))
  // The haze apart is built in place of the plain one where the clouds ask: its pipeline and the
  // capture's are compiled (`AtmosphereGpu.variantsReady`, asked by `askAtmosphere`).
  const haze = resources.pass(inputs.separate ? 'hazeSeparate' : 'haze')
  const cells = [
    groups(aerial.width, 4),
    groups(aerial.width, 4),
    groups(aerial.slices, 4),
  ] as const
  run(pass, haze, inputs.separate ? over.separate : over.haze, ...cells)
  if (inputs.capture360) run(pass, resources.pass('capture360'), over.capture360, ...cells)
}

/**
 * THE AIR'S WORK PER IMAGE, and what it remembers of the images before: the version it built the
 * tables for and the groups it binds over the light buffer.
 *
 * The air alone — its coefficients — builds the transmittance and the multiple-scattering tables,
 * once and again only when it is set. The image builds the sky table around the eye, the haze
 * volume and the sky's mean radiance for the fog, small, every image.
 */
export function createAirEncoder(device: GPUDevice, resources: AirResources) {
  const { frameBuffer } = resources
  let over: AirGroups | undefined
  let builtVersion = -1
  const computeDescriptor: GPUComputePassDescriptor = { label: 'Trillion3D air' }
  return {
    /** The groups over the light buffer of the last image, none before the first. */
    get groups() {
      return over
    },
    /** The tables and the volume of this image, built on `encoder`. */
    encode(encoder: GPUCommandEncoder, inputs: AirInputs) {
      const clouds = inputs.cloudShadow ?? resources.cloudShadowNone
      if (
        over?.buffer !== inputs.buffer ||
        !sameShadowMaps(over.maps, inputs.maps) ||
        !sameCloudShadow(over.cloudShadow, clouds)
      )
        over = airGroupsOver(resources, inputs.buffer, inputs.maps, clouds)
      device.queue.writeBuffer(frameBuffer, 0, inputs.frame)
      const pass = encoder.beginComputePass(computeDescriptor)
      // Every table's pipeline is compiled (`AtmosphereGpu.ready`, asked by `askAtmosphere`): the
      // version recorded is built.
      const rebuild = builtVersion !== inputs.version
      builtVersion = inputs.version
      encodeImageTables(pass, resources, over, inputs, rebuild)
      // The sky's mean radiance for the fog follows the sun and the air as they move, every image.
      run(pass, resources.pass('distantSky'), over.distantSky, 1)
      pass.end()
    },
  }
}
