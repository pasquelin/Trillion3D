import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import {
  airGroupsOver,
  sameCloudShadow,
  sameShadowMaps,
  type AirGroups,
  type AirShadowMaps,
} from './bindings.ts'
import type { CloudShadowSet } from './cloudShadowRead.ts'
import { PUBLISHED_TRANSMITTANCE, SKY_RAYS } from './layout.ts'
import type { AirPass, AirResources } from './resources.ts'

/** What an image tells the air's passes: the light buffer they read and write, the versions of the
 *  air and of the air with its sun, the image's frame (`writeAirFrame`), the shadow maps the air's
 *  lights shade it with, whether the clouds ask for the haze's light and the air's apart and for
 *  the haze around the capture's place, and the altitude of that place (what the sky sums are built
 *  for). */
export interface AirInputs {
  buffer: GPUBuffer
  version: number
  epoch: number
  frame: Float32Array<ArrayBuffer>
  maps: AirShadowMaps
  /** The clouds' shade the air's lights are read through; none: the resources' stand-in. */
  cloudShadow?: CloudShadowSet
  separate: boolean
  capture360: boolean
  captureKm: number
}

/** Groups of `size` threads that cover `n` texels. */
const groups = (n: number, size = 8) => ceilDiv(n, size)

/** The groups that cover the published transmittance's texels. */
const PUBLISHED_GROUPS = [
  groups(PUBLISHED_TRANSMITTANCE.width),
  groups(PUBLISHED_TRANSMITTANCE.height),
] as const
/** The groups that cover the sky by direction's texels. */
const SKY_RAYS_GROUPS = [groups(SKY_RAYS.azimuth), groups(SKY_RAYS.elevation)] as const

/** Dispatches `step` over `bound`, `x` by `y` by `z` groups. */
function run(
  pass: GPUComputePassEncoder,
  step: AirPass,
  bound: GPUBindGroup,
  x: number,
  y = 1,
  z = 1,
) {
  pass.setPipeline(step.pipeline.get())
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
  // The haze apart is built in place of the plain one where the clouds ask and its pipeline is made.
  const apart = inputs.separate && resources.pass('hazeSeparate')
  const haze = apart && apart.pipeline.ready ? apart : resources.pass('haze')
  const cells = [
    groups(aerial.width, 4),
    groups(aerial.width, 4),
    groups(aerial.slices, 4),
  ] as const
  run(pass, haze, haze === apart ? over.separate : over.haze, ...cells)
  const around = inputs.capture360 && resources.pass('capture360')
  if (around && around.pipeline.ready) run(pass, around, over.capture360, ...cells)
}

/**
 * THE AIR'S WORK PER IMAGE, and what it remembers of the images before: the versions it built the
 * tables for, the sun's epoch the sky by direction was built for, the altitude of the capture's
 * place it was built at, the light buffer it was built into, and how many times it was.
 *
 * The air alone — its coefficients — builds the transmittance and the multiple-scattering tables,
 * once and again only when it is set. The image builds the sky table around the eye, the haze
 * volume and the sky's mean radiance for the fog, small, every image. The sun, the air or the
 * capture's altitude moving builds the sky by direction once.
 */
export function createAirEncoder(device: GPUDevice, resources: AirResources) {
  const { frameBuffer } = resources
  let over: AirGroups | undefined
  let builtVersion = -1,
    builtEpoch = -1,
    builtKm = -1,
    skyBuilds = 0,
    skyBuffer: GPUBuffer | undefined
  const computeDescriptor: GPUComputePassDescriptor = { label: 'Trillion3D air' }
  return {
    /** The groups over the light buffer of the last image, none before the first. */
    get groups() {
      return over
    },
    /** How many times the sky by direction was built — the sun, the air, the capture's altitude or
     *  the light buffer changed —, counted as its pass is encoded. */
    get skyBuilds() {
      return skyBuilds
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
      const rebuild = builtVersion !== inputs.version
      builtVersion = inputs.version
      encodeImageTables(pass, resources, over, inputs, rebuild)
      // The sky's mean radiance for the fog follows the sun and the air as they move, every image.
      run(pass, resources.pass('distantSky'), over.distantSky, 1)
      if (
        builtEpoch !== inputs.epoch ||
        builtKm !== inputs.captureKm ||
        skyBuffer !== inputs.buffer
      ) {
        builtEpoch = inputs.epoch
        builtKm = inputs.captureKm
        skyBuffer = inputs.buffer
        run(pass, resources.pass('skyRays'), over.skyRays, ...SKY_RAYS_GROUPS)
        skyBuilds++
      }
      pass.end()
    },
  }
}
