import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { sameCloudShadow, sameShadowMaps, type AirGroups } from './bindings.ts'
import { airLayoutEntries } from './programs.ts'
import { opaqueHazeProgram } from './opaqueHazeWgsl.ts'
import type { AirResources } from './resources.ts'

/** The haze is laid over the lit image premultiplied: its light added, what is under it kept by its
 *  transmittance (the alpha). */
const OVER: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }

/**
 * THE HAZE MARCHED ON THE OPAQUE SURFACES, drawn (`opaqueHazeWgsl.ts`): made only where the shape
 * marches it (`aerialFastOnOpaque` off), its pipeline asked now, off the frame. The draw returns
 * whether it drew; nothing before the first image or until the pipeline is compiled. Its group is made
 * again when a resource it names is replaced.
 */
export function createOpaqueHazeDraw(
  device: GPUDevice,
  resources: AirResources,
  groups: () => AirGroups | undefined,
  failed: (error: unknown) => void,
) {
  const { shape, tables, sampler, frameBuffer, group } = resources
  if (shape.aerial.fastOnOpaque) return undefined
  const program = opaqueHazeProgram(shape)
  const layout = device.createBindGroupLayout({
    entries: airLayoutEntries(program.bindings, GPUShaderStage.FRAGMENT, shape),
  })
  const module = device.createShaderModule({ label: 'Trillion3D opaque haze', code: program.code })
  const pipeline = preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      module,
      layout,
      'opaqueHazeMain',
      [{ format: HDR_FORMAT, blend: { color: OVER, alpha: OVER } }],
      'Trillion3D opaque haze',
    ),
  ).ask()
  pipeline.prepare().catch(failed)
  let held:
    | { over: AirGroups; flags: GPUTextureView; depth: GPUTextureView; noise: GPUTextureView }
    | undefined
  let bound: GPUBindGroup | undefined
  const attachment: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'load',
    storeOp: 'store',
  }
  const descriptor: GPURenderPassDescriptor = {
    label: 'Trillion3D opaque haze',
    colorAttachments: [attachment],
  }
  return {
    get ready() {
      return pipeline.ready
    },
    /** The haze over `hdr`, `width × height` pixels, on the pixels `flags` says a surface drew, at
     *  the depths of `depth`, the march jittered by `noise`. */
    draw(
      encoder: GPUCommandEncoder,
      hdr: GPUTextureView,
      flags: GPUTextureView,
      depth: GPUTextureView,
      width: number,
      height: number,
      noise: GPUTextureView,
    ) {
      const over = groups()
      if (!over || !pipeline.ready) return
      const same =
        held &&
        held.over.buffer === over.buffer &&
        held.flags === flags &&
        held.depth === depth &&
        held.noise === noise &&
        sameShadowMaps(held.over.maps, over.maps) &&
        sameCloudShadow(held.over.cloudShadow, over.cloudShadow)
      if (!bound || !same) {
        bound = group(program, layout, {
          air: { buffer: over.buffer },
          transmittance: tables.transmittance.view,
          multiScatter: tables.multiScatter.view,
          sampler,
          frame: { buffer: frameBuffer },
          flags,
          depth,
          noise,
          pageTable: { buffer: over.maps.pageTable },
          projectionData: { buffer: over.maps.projectionData },
          shadowUniforms: { buffer: over.maps.uniforms },
          shadowPool: { buffer: over.maps.pool },
          shadowView: { buffer: over.maps.view },
          cloudShadow: { buffer: over.cloudShadow.block },
          cloudShadowMap0: over.cloudShadow.maps[0],
          cloudShadowMap1: over.cloudShadow.maps[1],
        })
        held = { over, flags, depth, noise }
      }
      attachment.view = hdr
      const pass = encoder.beginRenderPass(descriptor)
      pass.setViewport(0, 0, width, height, 0, 1)
      pass.setPipeline(pipeline.get())
      pass.setBindGroup(0, bound)
      pass.draw(3)
      pass.end()
    },
  }
}
