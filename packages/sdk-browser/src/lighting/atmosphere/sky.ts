import type { AirGroups } from './bindings.ts'
import type { AirResources } from './resources.ts'

/**
 * THE SKY'S DRAW over the lit image: a fullscreen pass, premultiplied, where no surface was drawn.
 * Its group over the light buffer and the flags is made when either is replaced.
 */
export function createSkyDraw(resources: AirResources) {
  const { tables, sampler, frameBuffer, skyLayout, skyPipeline, group } = resources
  let skyGroup: GPUBindGroup | undefined,
    skyFlags: GPUTextureView | undefined,
    skyBufferBound: GPUBuffer | undefined
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
   *  image (`over`); nothing before the first. */
  return (
    encoder: GPUCommandEncoder,
    over: AirGroups | undefined,
    hdr: GPUTextureView,
    flags: GPUTextureView,
    width: number,
    height: number,
  ) => {
    if (!over) return
    if (skyBufferBound !== over.buffer || skyFlags !== flags || !skyGroup) {
      skyGroup = group(skyLayout, {
        air: { buffer: over.buffer },
        transmittance: tables.transmittance.view,
        skyView: tables.skyView.view,
        sampler,
        frame: { buffer: frameBuffer },
        flags,
      })
      skyBufferBound = over.buffer
      skyFlags = flags
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
