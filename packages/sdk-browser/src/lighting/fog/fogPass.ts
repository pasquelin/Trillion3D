import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { HEIGHT_FOG_PASS } from '../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { heightFogLayoutEntries } from '../deferred/layoutEntries.ts'
import { createPassGroup } from '../deferred/passGroup.ts'
import { fogReadBindEntries, type FogRead } from './read.ts'
import { FOG_PASS_BINDINGS, HEIGHT_FOG_ENTRY, heightFogWgsl } from './fogPassWgsl.ts'

/** The fog laid over the image, premultiplied: its inscattering added, what was there kept by what
 *  the fog's coverage (the pass's alpha, one minus the transmittance) lets through, the image's alpha,
 *  the share of the background left visible, kept the same way. A fog that holds its light out
 *  (`SceneHeightFog.holdout`) adds its coverage to that alpha instead, punching a hole in it. */
const FOG_OVER: GPUBlendState = {
  color: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
  alpha: { operation: 'add', srcFactor: 'zero', dstFactor: 'one-minus-src-alpha' },
}
const FOG_HOLDOUT: GPUBlendState = {
  color: FOG_OVER.color,
  alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
}

/** What the fog pass is bound to: the frame's resources, each by its stand-in where the image has none. */
export interface FogPassResources {
  surface: SurfaceBuffer
  depth: GPUTextureView
  /** The light buffer (the fog's blocks, the atmosphere's and the haze's view). */
  lights: GPUBuffer
  fog: FogRead
  lightShaft: GPUTextureView
  /** The volume of the haze, a 3D texture (`AirResources.hazeVolume`), or its stand-in. */
  haze: GPUTextureView
}

/** The pipeline of the fog pass for a blend, asked now, off the frame. */
function fogPipelineOf(
  device: GPUDevice,
  layout: GPUBindGroupLayout,
  localFog: boolean,
  failed: (error: unknown) => void,
) {
  const module = device.createShaderModule({
    label: HEIGHT_FOG_PASS,
    code: wgslModule(heightFogWgsl(localFog)),
  })
  return (blend: GPUBlendState) => {
    const made = preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        module,
        layout,
        HEIGHT_FOG_ENTRY,
        [{ format: HDR_FORMAT, blend }],
        HEIGHT_FOG_PASS,
      ),
    ).ask()
    made.prepare().catch(failed)
    return made
  }
}

/** The entries of the pass's group over the resources of an image. */
function fogEntries(
  bindings: ReturnType<typeof FOG_PASS_BINDINGS>,
  view: GPUBuffer,
  r: FogPassResources,
) {
  return [
    ...namedEntries(DEFERRED_BINDINGS, {
      words: r.surface.stores()[1],
      depth: r.depth,
      view: { buffer: view },
      lights: { buffer: r.lights },
      hazeVolume: r.haze,
    }),
    ...fogReadBindEntries(bindings, r.fog, r.lightShaft),
  ]
}

/**
 * The fog pass of a device (`HEIGHT_FOG_ENTRY`): its pipeline asked now, off the frame, and the
 * frames waiting for it (`preparedPipeline`); its group made again when a resource it names is
 * replaced. `localFog`, the project switch `localFogVolumeSupport`: whether the program holds the
 * local fog volumes' code. `view` is the lighting's view uniform.
 */
export function createHeightFogPass(
  device: GPUDevice,
  view: GPUBuffer,
  localFog: boolean,
  failed: (error: unknown) => void,
) {
  const bindings = FOG_PASS_BINDINGS(localFog)
  const layout = device.createBindGroupLayout({ entries: heightFogLayoutEntries(localFog) })
  const pipelineOf = fogPipelineOf(device, layout, localFog, failed)
  const pipeline = pipelineOf(FOG_OVER)
  // The holdout's blend is made at the first image that holds the fog out.
  let holdoutPipeline: ReturnType<typeof pipelineOf> | undefined
  const group = createPassGroup(device, layout)
  const attachment: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'load',
    storeOp: 'store',
  }
  const descriptor: GPURenderPassDescriptor = {
    label: HEIGHT_FOG_PASS,
    colorAttachments: [attachment],
  }
  return {
    /** Whether the pipeline is compiled: a frame that finds it not draws no fog. */
    get ready() {
      return pipeline.ready
    },
    /** Lays the fog over the `width` × `height` pixels of `hdr`, holding its light out (`holdout`). */
    draw(
      encoder: GPUCommandEncoder,
      hdr: GPUTextureView,
      r: FogPassResources,
      width: number,
      height: number,
      holdout = false,
    ) {
      if (holdout) holdoutPipeline ??= pipelineOf(FOG_HOLDOUT)
      const drawn = holdout ? holdoutPipeline! : pipeline
      if (!drawn.ready) return
      const bound = group.get(
        [
          r.surface,
          r.depth,
          r.lights,
          r.fog,
          r.fog.cubemap,
          r.fog.volume,
          r.fog.tiles,
          r.lightShaft,
          r.haze,
        ],
        () => fogEntries(bindings, view, r),
      )
      attachment.view = hdr
      drawFullscreenTriangle(encoder, descriptor, drawn.get(), bound, width, height)
    },
    release: () => group.release(),
  }
}

/** The fog pass of a device. */
