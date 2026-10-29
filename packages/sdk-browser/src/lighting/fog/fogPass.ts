import { drawFullscreenTriangle } from '../../gpu/shader/fullscreenTriangle.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { HEIGHT_FOG_PASS } from '../../diagnostic/stage/passLabels.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { DEFERRED_BINDINGS } from '../deferred/bindings.ts'
import { fullscreenDescriptor, preparedPipeline } from '../deferred/fullscreen.ts'
import { fogBehindWaterLayoutEntries, heightFogLayoutEntries } from '../deferred/layoutEntries.ts'
import { createPassGroup } from '../deferred/passGroup.ts'
import { fogReadBindEntries, type FogRead } from './read.ts'
import {
  FOG_BEHIND_WATER_ENTRY,
  FOG_PASS_BINDINGS,
  HEIGHT_FOG_ENTRY,
  fogBehindWaterWgsl,
  heightFogWgsl,
} from './fogPassWgsl.ts'

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
  behindWater = false,
) {
  const module = device.createShaderModule({
    label: HEIGHT_FOG_PASS,
    code: wgslModule(behindWater ? fogBehindWaterWgsl(localFog) : heightFogWgsl(localFog)),
  })
  return (blend: GPUBlendState) => {
    const made = preparedPipeline(
      device,
      fullscreenDescriptor(
        device,
        module,
        layout,
        behindWater ? FOG_BEHIND_WATER_ENTRY : HEIGHT_FOG_ENTRY,
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

/** The fog behind the water: its own layout, pipeline and group. */
function behindWaterPass(d: GPUDevice, local: boolean, failedWith: (error: unknown) => void) {
  const behindLayout = d.createBindGroupLayout({ entries: fogBehindWaterLayoutEntries(local) })
  const pipeline = fogPipelineOf(d, behindLayout, local, failedWith, true)(FOG_OVER)
  const { attachment, descriptor } = colourPass()
  return { pipeline, group: createPassGroup(d, behindLayout), attachment, descriptor }
}

/** A pass that loads and stores one colour attachment, its view set at each draw. */
function colourPass() {
  const attachment: GPURenderPassColorAttachment = {
    view: undefined as unknown as GPUTextureView,
    loadOp: 'load',
    storeOp: 'store',
  }
  return {
    attachment,
    descriptor: {
      label: HEIGHT_FOG_PASS,
      colorAttachments: [attachment],
    } as GPURenderPassDescriptor,
  }
}

/** Lays the fog over `target` at the water's linear depths, once the program is compiled. */
function drawBehindWater(
  encoder: GPUCommandEncoder,
  behind: ReturnType<typeof behindWaterPass>,
  entries: () => GPUBindGroupEntry[],
  r: FogPassResources,
  target: GPUTextureView,
  waterDepth: GPUTextureView,
  width: number,
  height: number,
) {
  if (!behind.pipeline.ready) return
  const bound = behind.group.get(fogDependencies(r, waterDepth), () => [
    ...entries(),
    { binding: DEFERRED_BINDINGS.waterLinearDepth, resource: waterDepth },
  ])
  behind.attachment.view = target
  drawFullscreenTriangle(encoder, behind.descriptor, behind.pipeline.get(), bound, width, height)
}

/** The resources the fog's group 0 names, and the water's depths when it is the group behind the water. */
function fogDependencies(r: FogPassResources, waterDepth?: GPUTextureView) {
  const named: object[] = [
    r.surface,
    r.depth,
    r.lights,
    r.fog,
    r.fog.cubemap,
    r.fog.volume,
    r.fog.tiles,
    r.lightShaft,
    r.haze,
  ]
  if (waterDepth) named.push(waterDepth)
  return named
}

/** The pass's group 0 over `r`, made again when a resource it names is replaced. */
function fogGroup(
  group: ReturnType<typeof createPassGroup>,
  bindings: ReturnType<typeof FOG_PASS_BINDINGS>,
  view: GPUBuffer,
  r: FogPassResources,
) {
  return group.get(fogDependencies(r), () => fogEntries(bindings, view, r))
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
  // The holdout's blend, made at the first image that holds the fog out.
  let holdoutPipeline: ReturnType<typeof pipelineOf> | undefined
  const group = createPassGroup(device, layout)
  // The fog behind the water: its own layout, program and group, made at the first image that asks.
  let behind: ReturnType<typeof behindWaterPass> | undefined
  const { attachment, descriptor } = colourPass()
  const groupOf = (r: FogPassResources) => fogGroup(group, bindings, view, r)
  return {
    /** The layout of the pass's group 0, `localFog` the project switch it was made for, and its group over `r`: a pass that lays the
     *  fog over a layer of its own binds them (`fogOverModules`). */
    layout,
    localFog,
    groupOf,
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
      const bound = groupOf(r)
      attachment.view = hdr
      drawFullscreenTriangle(encoder, descriptor, drawn.get(), bound, width, height)
    },
    /** Lays the fog over the scene without the water (`target`, the water pass's colour copy) at the surface depths its linear depth
     *  (`waterDepth`) holds, `width` × `height` texels; nothing while the program is not compiled. */
    drawBehindWater(
      encoder: GPUCommandEncoder,
      target: GPUTextureView,
      r: FogPassResources,
      waterDepth: GPUTextureView,
      width: number,
      height: number,
    ) {
      behind ??= behindWaterPass(device, localFog, failed)
      drawBehindWater(
        encoder,
        behind,
        () => fogEntries(bindings, view, r),
        r,
        target,
        waterDepth,
        width,
        height,
      )
    },
    release: () => {
      group.release()
      behind?.group.release()
    },
  }
}

/** The fog pass of a device. */
