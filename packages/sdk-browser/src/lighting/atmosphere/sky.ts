import type { AirGroups } from './bindings.ts'
import type { AirResources } from './resources.ts'
import type { FogRead } from '../fog/read.ts'

/**
 * THE SKY'S DRAW over the lit image: a fullscreen pass, premultiplied, where no surface was drawn.
 * Its group over the light buffer, the flags and the fog's resources is made when one is replaced.
 */
export function createSkyDraw(resources: AirResources) {
  const { tables, sampler, frameBuffer, skyLayout, skyPipeline, group } = resources
  let skyGroup: GPUBindGroup | undefined,
    skyFlags: GPUTextureView | undefined,
    skyBufferBound: GPUBuffer | undefined,
    skyFog: FogRead | undefined
  const compose: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'load',
    storeOp: 'store',
  }
  const composeDescriptor: GPURenderPassDescriptor = {
    label: 'Trillion3D sky',
    colorAttachments: [compose],
  }
  /** The sky over `hdr`, `width × height` pixels, reading `flags`, over the groups of the last
   *  image (`over`), the fog laid over it read from `fog`; nothing before the first. */
  return (
    encoder: GPUCommandEncoder,
    over: AirGroups | undefined,
    hdr: GPUTextureView,
    flags: GPUTextureView,
    width: number,
    height: number,
    fog: FogRead,
  ) => {
    if (!over) return
    if (skyBufferBound !== over.buffer || skyFlags !== flags || skyFog !== fog || !skyGroup) {
      skyGroup = group(skyLayout, {
        air: { buffer: over.buffer },
        transmittance: tables.transmittance.view,
        skyView: tables.skyView.view,
        sampler,
        frame: { buffer: frameBuffer },
        flags,
        fogSampler: fog.sampler,
        fogCubemap: fog.cubemap,
        fogVolume: fog.volume,
      })
      skyBufferBound = over.buffer
      skyFlags = flags
      skyFog = fog
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
