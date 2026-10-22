import { sameCloudShadow, sameShadowMaps, type AirGroups, type AirShadowMaps } from './bindings.ts'
import type { CloudShadowSet } from './cloudShadowRead.ts'
import type { AirResources } from './resources.ts'
import type { FogRead } from '../fog/read.ts'

/** What the sky's bind group is made of: the buffer, the flags, the fog's resources and the noise. */
interface SkyBound {
  buffer: GPUBuffer
  flags: GPUTextureView
  fog: FogRead
  lightShaft: GPUTextureView
  noise: GPUTextureView
  maps: AirShadowMaps
  cloud: CloudShadowSet
}

/** Whether two sets name the same resources. */
const sameBound = (a: SkyBound | undefined, b: SkyBound) =>
  !!a &&
  a.buffer === b.buffer &&
  a.flags === b.flags &&
  a.fog === b.fog &&
  a.lightShaft === b.lightShaft &&
  a.noise === b.noise &&
  sameShadowMaps(a.maps, b.maps) &&
  sameCloudShadow(a.cloud, b.cloud)

/**
 * THE SKY'S DRAW over the lit image: a fullscreen pass, premultiplied, where no surface was drawn.
 * Its group over the light buffer, the flags, the fog's resources and, where the sky is marched,
 * the blue noise, is made when one is replaced. `groups` gives the groups of the last image's
 * passes (`AirEncoder.groups`), none before the first.
 */
export function createSkyDraw(resources: AirResources, groups: () => AirGroups | undefined) {
  const { tables, sampler, frameBuffer, skyProgram, skyLayout, skyPipeline, group } = resources
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
  /** The sky over `hdr`, `width × height` pixels, reading `flags`, the fog laid over it read from
   *  `fog`, the light shafts' mask `lightShaft`, the sky marched with `noise`; nothing before the first image. */
  return (
    encoder: GPUCommandEncoder,
    hdr: GPUTextureView,
    flags: GPUTextureView,
    width: number,
    height: number,
    fog: FogRead,
    lightShaft: GPUTextureView,
    noise: GPUTextureView,
  ) => {
    const over = groups()
    if (!over) return
    const next = {
      buffer: over.buffer,
      flags,
      fog,
      lightShaft,
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
        fogSampler: fog.sampler,
        fogCubemap: fog.cubemap,
        fogVolume: fog.volume,
        lightShaft,
        pageTable: { buffer: over.maps.pageTable },
        projectionData: { buffer: over.maps.projectionData },
        shadowUniforms: { buffer: over.maps.uniforms },
        shadowPool: { buffer: over.maps.pool },
        shadowView: { buffer: over.maps.view },
        cloudShadow: { buffer: over.cloudShadow.block },
        cloudShadowMap0: over.cloudShadow.maps[0],
        cloudShadowMap1: over.cloudShadow.maps[1],
      })
      bound = next
    }
    compose.view = hdr
    const pass = encoder.beginRenderPass(composeDescriptor)
    pass.setViewport(0, 0, width, height, 0, 1)
    pass.setPipeline(skyPipeline.get())
    pass.setBindGroup(0, skyGroup)
    pass.draw(3)
    pass.end()
  }
}
