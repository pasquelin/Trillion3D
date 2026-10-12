import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { validated } from '../gpu/core/errorScope.ts'
import { shaderFailed } from '../gpu/core/shaderModule.ts'
import { COMPUTE, computeBufferEntry, computeTextureEntry } from '../gpu/core/computeBindings.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { buildComputeStages } from '../lighting/deferred/fullscreen.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'
import type { GpuHiz, HizDepth } from '../gpu/hiz/types.ts'
import { hizDepthBindEntries, hizDepthEntries } from '../gpu/hiz/pyramidTexture.ts'
import { REFLECTION_FORMAT } from './constants.ts'
import { FRONT_SHADER, createFrontDepth, frontBytes, frontLayout } from './frontDepth.ts'
import {
  RADIANCE_SHADER,
  createRadiancePyramid,
  radianceLayouts,
  radianceLevels,
} from './radiance.ts'
import { RADIANCE_HASH_BYTES, SAMPLE_BYTES, createRadianceSettle } from './settle.ts'
import {
  BEGIN_SHADER,
  TRACE_SHADER,
  createTraceStages,
  createTraceTiles,
  TRACE_ARGS_BYTES,
  traceListBytes,
  type TraceGroups,
} from './trace.ts'
import { createReflectionViewWriter } from './viewWrite.ts'
import {
  REFLECTION_DEPTH_BINDING,
  REFLECTION_GROUP,
  REFLECTION_LIGHT_VIEW_BINDING,
  REFLECTION_SURFACE_BINDING,
  REFLECTION_VIEW_BYTES,
} from './viewLayout.ts'
import { REFLECTION_TARGET } from './weight.ts'

/** The reflection group's layout (`reflectionBindingsWgsl`), once a device: the view uniform, the
 *  radiance pyramid and its sampler, then the depth pyramid (`hizDepthEntries`), the lighting's
 *  view and the proxy's surface cache, read by compute and fragment stages. */
export const reflectionLayout = oncePerDevice((device: GPUDevice) => {
  const visibility = COMPUTE | GPUShaderStage.FRAGMENT
  return device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility,
        buffer: { type: 'uniform', minBindingSize: REFLECTION_VIEW_BYTES },
      },
      { binding: 1, visibility, texture: { sampleType: 'float' } },
      { binding: 2, visibility, sampler: { type: 'filtering' } },
      ...hizDepthEntries(REFLECTION_DEPTH_BINDING, visibility),
      computeBufferEntry(REFLECTION_LIGHT_VIEW_BINDING, 'uniform', visibility),
      computeTextureEntry(REFLECTION_SURFACE_BINDING, 'unfilterable-float', '2d', visibility),
    ],
  })
})

/** The reflection's kernels — the frame state, the opaque trace and its tile classification, the
 *  radiance pyramid's two, the front depth's scatter — compiled once a device under one validation scope. */
export const createReflectionPipelines = oncePerDevice((device: GPUDevice) =>
  validated(device, async () => {
    const modules = {
      trace: device.createShaderModule({
        label: 'Trillion3D reflection trace',
        code: TRACE_SHADER,
      }),
      begin: device.createShaderModule({
        label: 'Trillion3D reflection begin',
        code: BEGIN_SHADER,
      }),
      radiance: device.createShaderModule({
        label: 'Trillion3D reflection radiance',
        code: RADIANCE_SHADER,
      }),
      front: device.createShaderModule({
        label: 'Trillion3D reflection front depth',
        code: FRONT_SHADER,
      }),
    }
    for (const made of Object.values(modules)) if (await shaderFailed(made)) return undefined
    const layouts = radianceLayouts(device)
    const layout = (bind: GPUBindGroupLayout) =>
      device.createPipelineLayout({ bindGroupLayouts: [bind] })
    const frontLayouts = frontLayout(device)
    const [trace, first, down, roll, front] = await Promise.all([
      createTraceStages(device, modules, reflectionLayout(device)),
      buildComputeStages(device, layout(layouts.firstLayout), modules.radiance, ['radianceFirst']),
      buildComputeStages(device, layout(layouts.downLayout), modules.radiance, ['radianceDown']),
      buildComputeStages(device, layout(layouts.rollLayout), modules.radiance, ['radianceRoll']),
      buildComputeStages(device, layout(frontLayouts), modules.front, ['frontScatter']),
    ])
    return {
      ...trace,
      ...layouts,
      firstPipeline: first.radianceFirst,
      downPipeline: down.radianceDown,
      rollPipeline: roll.radianceRoll,
      frontLayout: frontLayouts,
      frontPipeline: front.frontScatter,
    }
  }),
)
export type ReflectionPipelines = NonNullable<Awaited<ReturnType<typeof createReflectionPipelines>>>

/** Bytes a view's reflection holds at `width × height` (`createScreenReflection`): its target, its
 *  radiance pyramid, its tile list, its uniform, its radiance hash and the front depth the blends
 *  write; the depth it marches is the Hi-Z's, with its front depth. */
export function reflectionBytes(width: number, height: number) {
  const size: GPUExtent3D = [width, height]
  return (
    REFLECTION_TARGET.bytes(width, height, true) +
    textureBytesOf({
      size,
      format: REFLECTION_FORMAT,
      mipLevelCount: radianceLevels(width, height),
    })! +
    frontBytes(width, height) +
    traceListBytes(width, height) +
    TRACE_ARGS_BYTES +
    REFLECTION_VIEW_BYTES +
    RADIANCE_HASH_BYTES +
    SAMPLE_BYTES * 3
  )
}

/**
 * A view's reflection at `width × height`: the target the opaque trace writes, the radiance
 * pyramid of its last lit image (`radiance`, which holds the image it was made of: the next image
 * reprojects its hits with its view-projection), the tile list of the trace, the view uniform —
 * whose surroundings the GPU writes — and the writer of the rest of it.
 */
export function createScreenReflection(device: GPUDevice, width: number, height: number) {
  // `COPY_SRC` and `COPY_DST` serve only the proof tools, which reread the target and set it first;
  // no frame copies it.
  const target = device.createTexture({
    label: 'Trillion3D reflection',
    size: [width, height],
    format: REFLECTION_FORMAT,
    usage: loadOnlyUsage() | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D reflection view',
    size: REFLECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const radiance = createRadiancePyramid(device, width, height)
  const tiles = createTraceTiles(device, width, height)
  const settle = createRadianceSettle(device)
  const front = createFrontDepth(device, width, height)
  return {
    device,
    target,
    targetView: target.createView(),
    radiance,
    tiles,
    uniform,
    settle,
    front,
    writeView: createReflectionViewWriter(device, uniform),
    /** The reflection group over each Hi-Z pyramid it was bound with (a view's), and what else it
     *  was made over. */
    groups: new WeakMap<GPUTexture, { group: GPUBindGroup; over: unknown[] }>(),
    /** The trace's bind groups, kept while its inputs stay (`encodeReflectionTrace`). */
    traceGroups: undefined as TraceGroups | undefined,
    dispose() {
      target.destroy()
      radiance.texture.destroy()
      tiles.args.destroy()
      tiles.list.destroy()
      uniform.destroy()
      settle.dispose()
      front.dispose()
    },
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>

/** What the reflection group holds beside the view's own buffers, the radiance pyramid and the
 *  depth: the deferred lighting's view, and the surface cache of the resident proxy (a texel of
 *  zero without a proxy). */
export type ReflectionOver = { lightView: GPUBuffer; surface: GPUTextureView }

/** The reflection group of `reflection` over the depth pyramid `depth` (`GpuHiz.depth`) and
 *  `over`, made once a pyramid and while they stay. */
export function reflectionGroup(
  reflection: ScreenReflection,
  depth: HizDepth,
  over: ReflectionOver,
) {
  const kept = reflection.groups.get(depth.pyramid)
  if (kept && kept.over[0] === over.lightView && kept.over[1] === over.surface) return kept.group
  const { device } = reflection
  const group = device.createBindGroup({
    label: 'Trillion3D reflection',
    layout: reflectionLayout(device),
    entries: [
      { binding: 0, resource: { buffer: reflection.uniform } },
      { binding: 1, resource: reflection.radiance.view },
      { binding: 2, resource: reflection.radiance.sampler },
      ...hizDepthBindEntries(REFLECTION_DEPTH_BINDING, depth),
      { binding: REFLECTION_LIGHT_VIEW_BINDING, resource: { buffer: over.lightView } },
      { binding: REFLECTION_SURFACE_BINDING, resource: over.surface },
    ],
  })
  reflection.groups.set(depth.pyramid, { group, over: [over.lightView, over.surface] })
  return group
}

/** What a frame holds that the reflection reads (`reflectionOver`). */
export type ReflectionHost = {
  gpu: {
    reflection?: ScreenReflection
    deferred?: { uniform: GPUBuffer; placeholders: { reflection: GPUTextureView } }
  }
  vis: { gpuHiz?: GpuHiz }
  bounce: { probes?: { surface: { view: GPUTextureView } } }
}

/** The reflection group's other resources: the lighting's view, the proxy's surface cache else a
 *  zero texel. Undefined while the lighting is not made. */
export function reflectionOver({ gpu, bounce }: ReflectionHost): ReflectionOver | undefined {
  const { deferred } = gpu
  if (!deferred) return undefined
  return {
    lightView: deferred.uniform,
    surface: bounce.probes?.surface.view ?? deferred.placeholders.reflection,
  }
}

/** Binds, in the forward `pass`, the reflection group (`REFLECTION_GROUP`): the view's reflection
 *  over its depth pyramid, both made with the frame's targets and the visibility programs. */
export function bindForwardReflection(pass: GPURenderPassEncoder, rt: ReflectionHost) {
  const depth = rt.vis.gpuHiz?.depth(),
    over = reflectionOver(rt)
  if (rt.gpu.reflection && depth && over)
    pass.setBindGroup(REFLECTION_GROUP, reflectionGroup(rt.gpu.reflection, depth, over))
}

/**
 * Whether the view's reflections are what a still view shows: the radiance pyramid holds an image
 * of this view, and — when no temporal accumulation turns the projection from image to image, whose
 * own settling covers it — that image was drawn from where the one before it was, and its lit
 * image is the one before it's (`settle.verified`), so the image traced on it reflects the view as
 * it stands, never the one it moved from nor the light it changed. A held image is then final:
 * drawn again, it gives the same bits.
 */
export const reflectionsSettled = (
  reflection: ScreenReflection | undefined,
  accumulating: boolean,
) =>
  !reflection ||
  (reflection.radiance.held.valid &&
    (accumulating || (reflection.radiance.held.still && reflection.settle.verified)))
