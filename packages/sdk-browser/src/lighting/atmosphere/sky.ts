import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import {
  cloudShadeResources,
  sameCloudShadow,
  sameShadowMaps,
  shadowMapResources,
  type AirGroups,
  type AirShadowMaps,
} from './bindings.ts'
import type { CloudShadowSet } from './cloudShadowRead.ts'
import type { AirResources } from './resources.ts'

/** What the sky's bind group is made of: the buffer, the flags and the noise. */
interface SkyBound {
  buffer: GPUBuffer
  flags: GPUTextureView
  noise: GPUTextureView
  maps: AirShadowMaps
  cloud: CloudShadowSet
}

/** Whether two sets name the same resources. */
const sameBound = (a: SkyBound | undefined, b: SkyBound) =>
  !!a &&
  a.buffer === b.buffer &&
  a.flags === b.flags &&
  a.noise === b.noise &&
  sameShadowMaps(a.maps, b.maps) &&
  sameCloudShadow(a.cloud, b.cloud)

/**
 * THE SKY'S DRAW over the lit image: a fullscreen pass, premultiplied, where no surface was drawn.
 * Its group over the light buffer, the flags and, where the sky is marched, the blue noise, is made
 * when one is replaced. The fog is not laid here: the fog pass lays it over the image and the sky
 * (`../fog/fogPass.ts`). `groups` gives the groups of the last image's
 * passes (`AirEncoder.groups`), none before the first.
 */
export function createSkyDraw(resources: AirResources, groups: () => AirGroups | undefined) {
  const { tables, sampler, frameBuffer, skyProgram, skyLayout, skyPipeline, skyHoldoutPipeline } =
    resources
  const { group } = resources
  let bound: SkyBound | undefined, skyGroup: GPUBindGroup | undefined
  const compose: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'load',
    storeOp: 'store',
  }
  const composeDescriptor: GPURenderPassDescriptor = {
    label: 'Trillion3D sky',
    colorAttachments: [compose],
  }
  /** The sky over `hdr`, `width × height` pixels, reading `flags`, the sky marched with `noise`,
   *  holding its light out where `holdout` says; nothing before the first image. */
  return (
    encoder: GPUCommandEncoder,
    hdr: GPUTextureView,
    flags: GPUTextureView,
    width: number,
    height: number,
    noise: GPUTextureView,
    holdout = false,
  ) => {
    const over = groups()
    if (!over) return
    const next = {
      buffer: over.buffer,
      flags,
      noise,
      maps: over.maps,
      cloud: over.cloudShadow,
    }
    if (!skyGroup || !sameBound(bound, next)) {
      skyGroup = group(skyProgram, skyLayout, {
        air: { buffer: next.buffer },
        transmittance: tables.transmittance.view,
        multiScatter: tables.multiScatter.view,
        skyView: tables.skyView.view,
        sampler,
        frame: { buffer: frameBuffer },
        flags,
        noise,
        ...shadowMapResources(over.maps),
        ...cloudShadeResources(over.cloudShadow),
      })
      bound = next
    }
    compose.view = hdr
    const pipeline = holdout ? skyHoldoutPipeline() : skyPipeline
    if (!pipeline.ready) return
    drawFullscreenTriangle(encoder, composeDescriptor, pipeline.get(), skyGroup, width, height)
  }
}
