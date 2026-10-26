import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import {
  cloudShadeResources,
  sameCloudShadow,
  sameShadowMaps,
  shadowMapResources,
  type AirGroups,
} from './bindings.ts'
import { airLayoutEntries } from './programs.ts'
import { opaqueHazeProgram } from './opaqueHazeWgsl.ts'
import type { AirResources } from './resources.ts'

/** The haze is laid over the lit image premultiplied: its light added, what is under it kept by its
 *  transmittance (the alpha), the image's own alpha, the share of the background left visible, kept
 *  the same way. */
const OVER: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }
const ALPHA_THROUGH: GPUBlendComponent = { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' }

/** The held group's inputs. */
interface HeldHaze {
  over: AirGroups
  flags: GPUTextureView
  depth: GPUTextureView
  noise: GPUTextureView
}

/** Whether the group made over `held` still names the resources of this image. */
function sameInputs(
  held: HeldHaze,
  over: AirGroups,
  flags: GPUTextureView,
  depth: GPUTextureView,
  noise: GPUTextureView,
) {
  return (
    held.over.buffer === over.buffer &&
    held.flags === flags &&
    held.depth === depth &&
    held.noise === noise &&
    sameShadowMaps(held.over.maps, over.maps) &&
    sameCloudShadow(held.over.cloudShadow, over.cloudShadow)
  )
}

/** The haze's pipeline, asked now, off the frame. */
function opaqueHazePipeline(
  device: GPUDevice,
  code: string,
  layout: GPUBindGroupLayout,
  failed: (error: unknown) => void,
) {
  const module = device.createShaderModule({ label: 'Trillion3D opaque haze', code })
  const pipeline = preparedPipeline(
    device,
    fullscreenDescriptor(
      device,
      module,
      layout,
      'opaqueHazeMain',
      [{ format: HDR_FORMAT, blend: { color: OVER, alpha: ALPHA_THROUGH } }],
      'Trillion3D opaque haze',
    ),
  ).ask()
  pipeline.prepare().catch(failed)
  return pipeline
}

/** What the haze's group names. */
function hazeResources(
  { tables, sampler, frameBuffer }: AirResources,
  over: AirGroups,
  flags: GPUTextureView,
  depth: GPUTextureView,
  noise: GPUTextureView,
) {
  return {
    air: { buffer: over.buffer },
    transmittance: tables.transmittance.view,
    multiScatter: tables.multiScatter.view,
    sampler,
    frame: { buffer: frameBuffer },
    flags,
    depth,
    noise,
    ...shadowMapResources(over.maps),
    ...cloudShadeResources(over.cloudShadow),
  }
}

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
  const { shape, group } = resources
  if (shape.aerial.fastOnOpaque) return undefined
  const program = opaqueHazeProgram(shape)
  const layout = device.createBindGroupLayout({
    entries: airLayoutEntries(program.bindings, GPUShaderStage.FRAGMENT, shape),
  })
  const pipeline = opaqueHazePipeline(device, program.code, layout, failed)
  let held: HeldHaze | undefined
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
      const same = held && sameInputs(held, over, flags, depth, noise)
      if (!bound || !same) {
        bound = group(program, layout, hazeResources(resources, over, flags, depth, noise))
        held = { over, flags, depth, noise }
      }
      attachment.view = hdr
      drawFullscreenTriangle(encoder, descriptor, pipeline.get(), bound, width, height)
    },
  }
}
