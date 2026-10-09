import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { validated } from '../gpu/core/errorScope.ts'
import { shaderFailed } from '../gpu/core/shaderModule.ts'
import { COMPUTE } from '../gpu/core/computeBindings.ts'
import { textureBytesOf } from '../gpu/core/textureBytes.ts'
import { buildComputeStages } from '../lighting/deferred/fullscreen.ts'
import { loadOnlyUsage } from '../gpu/core/loadOnlyTarget.ts'
import type { GpuHiz, HizDepth } from '../gpu/hiz/types.ts'
import { hizDepthEntries } from '../gpu/hiz/pyramidTexture.ts'
import { REFLECTION_FORMAT } from './constants.ts'
import {
  RADIANCE_SHADER,
  createRadiancePyramid,
  radianceLayouts,
  radianceLevels,
} from './radiance.ts'
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
import { REFLECTION_DEPTH_BINDING, REFLECTION_GROUP, REFLECTION_VIEW_BYTES } from './viewLayout.ts'
import { REFLECTION_TARGET } from './weight.ts'

/** The reflection group's layout (`reflectionBindingsWgsl`), once a device: the view uniform, the
 *  radiance pyramid and its sampler, then the depth pyramid (`hizDepthEntries`), read by compute
 *  and fragment stages. */
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
    ],
  })
})

/** The reflection's kernels — the frame state, the opaque trace and its tile classification, the
 *  radiance pyramid's two — compiled once a device under one validation scope. */
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
    }
    for (const made of Object.values(modules)) if (await shaderFailed(made)) return undefined
    const layouts = radianceLayouts(device)
    const layout = (bind: GPUBindGroupLayout) =>
      device.createPipelineLayout({ bindGroupLayouts: [bind] })
    const [trace, first, down] = await Promise.all([
      createTraceStages(device, modules, reflectionLayout(device)),
      buildComputeStages(device, layout(layouts.firstLayout), modules.radiance, ['radianceFirst']),
      buildComputeStages(device, layout(layouts.downLayout), modules.radiance, ['radianceDown']),
    ])
    return {
      ...trace,
      ...layouts,
      firstPipeline: first.radianceFirst,
      downPipeline: down.radianceDown,
    }
  }),
)
export type ReflectionPipelines = NonNullable<Awaited<ReturnType<typeof createReflectionPipelines>>>

/** Bytes a view's reflection holds at `width × height` (`createScreenReflection`): its target, its
 *  radiance pyramid, its tile list and its uniform; the depth it marches is the Hi-Z's. */
export function reflectionBytes(width: number, height: number) {
  const size: GPUExtent3D = [width, height]
  return (
    REFLECTION_TARGET.bytes(width, height, true) +
    textureBytesOf({
      size,
      format: REFLECTION_FORMAT,
      mipLevelCount: radianceLevels(width, height),
    })! +
    traceListBytes(width, height) +
    TRACE_ARGS_BYTES +
    REFLECTION_VIEW_BYTES
  )
}

/**
 * A view's reflection at `width × height`: the target the opaque trace writes, the radiance
 * pyramid of its last lit image (`radiance`, which holds the image it was made of: the next image
 * reprojects its hits with its view-projection), the tile list of the trace, the view uniform —
 * whose surroundings the GPU writes — and the writer of the rest of it.
 */
export function createScreenReflection(device: GPUDevice, width: number, height: number) {
  // `COPY_SRC` serves only the proof tools, which reread the target; no frame copies it.
  const target = device.createTexture({
    label: 'Trillion3D reflection',
    size: [width, height],
    format: REFLECTION_FORMAT,
    usage: loadOnlyUsage() | GPUTextureUsage.COPY_SRC,
  })
  const uniform = device.createBuffer({
    label: 'Trillion3D reflection view',
    size: REFLECTION_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const radiance = createRadiancePyramid(device, width, height)
  const tiles = createTraceTiles(device, width, height)
  return {
    device,
    target,
    targetView: target.createView(),
    radiance,
    tiles,
    uniform,
    writeView: createReflectionViewWriter(device, uniform),
    /** The reflection group over each Hi-Z pyramid it was bound with (a view's). */
    groups: new WeakMap<GPUTexture, GPUBindGroup>(),
    /** The trace's bind groups, kept while its inputs stay (`encodeReflectionTrace`). */
    traceGroups: undefined as TraceGroups | undefined,
    dispose() {
      target.destroy()
      radiance.texture.destroy()
      tiles.args.destroy()
      tiles.list.destroy()
      uniform.destroy()
    },
  }
}
export type ScreenReflection = ReturnType<typeof createScreenReflection>

/** The reflection group of `reflection` over the depth pyramid `depth` (`GpuHiz.depth`), made
 *  once a pyramid. */
export function reflectionGroup(reflection: ScreenReflection, depth: HizDepth) {
  const kept = reflection.groups.get(depth.pyramid)
  if (kept) return kept
  const { device } = reflection
  const group = device.createBindGroup({
    label: 'Trillion3D reflection',
    layout: reflectionLayout(device),
    entries: [
      { binding: 0, resource: { buffer: reflection.uniform } },
      { binding: 1, resource: reflection.radiance.view },
      { binding: 2, resource: reflection.radiance.sampler },
      ...depth.resources.map((resource, k) => ({
        binding: REFLECTION_DEPTH_BINDING + k,
        resource,
      })),
    ],
  })
  reflection.groups.set(depth.pyramid, group)
  return group
}

/** Binds, in the forward `pass`, the reflection group (`REFLECTION_GROUP`): the view's reflection
 *  over its depth pyramid, both made with the frame's targets and the visibility programs. */
export function bindForwardReflection(
  pass: GPURenderPassEncoder,
  { gpu, vis }: { gpu: { reflection?: ScreenReflection }; vis: { gpuHiz?: GpuHiz } },
) {
  const depth = vis.gpuHiz?.depth()
  if (gpu.reflection && depth)
    pass.setBindGroup(REFLECTION_GROUP, reflectionGroup(gpu.reflection, depth))
}

/**
 * Whether the view's reflections are what a still view shows: the radiance pyramid holds an image
 * of this view, and — when no temporal accumulation turns the projection from image to image, whose
 * own settling covers it — that image was drawn from where the one before it was, so the image
 * traced on it reflects the view as it stands, never the one it moved from. A held image is then
 * final: drawn again, it gives the same bits.
 */
export const reflectionsSettled = (
  reflection: ScreenReflection | undefined,
  accumulating: boolean,
) =>
  !reflection ||
  (reflection.radiance.held.valid && (accumulating || reflection.radiance.held.still))
