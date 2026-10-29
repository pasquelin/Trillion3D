import { dagReadGroupEntries } from '../../geometry/dag/shader/bindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { entriesIdentity } from '../../gpu/bind/entriesIdentity.ts'
import { shadeBindEntries } from '../../gpu/bind/bindEntries.ts'
import { sceneHitCornersBindEntry } from '../rays/sceneTrace/sceneHitCornersWgsl.ts'
import { sceneTraceBindEntries } from '../rays/sceneTrace/sceneTraceWgsl.ts'
import type { SceneRays } from '../surfaceCache/lighting/surfaceLighting.ts'
import { PT_ARGS_BINDINGS } from './argsProgram.ts'
import { PT_FINISH_BINDINGS } from './finishWgsl.ts'
import type { PathTracingGpu } from './gpuState.ts'
import type { PathTracingPipelines } from './pipelines.ts'
import { PT_SHADE_RESOURCE_BINDINGS, type hitShadePipelinesOf } from './shadeHitPipelines.ts'
import { PT_SHADE_PATHS } from './shadeHitWgsl.ts'
import { PT_TRACE_STAGE_BINDINGS } from './traceBounceWgsl.ts'
import { PT_TRACE_BINDINGS, PT_TRACE_SCENE } from './traceProgram.ts'
import { PT_VIEW } from './viewWgsl.ts'

/** One bind group, made again only where the layout or a resource it names is not what the last call named (`createWebgpuBindIdentity`). */
function cachedGroup() {
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return (
    device: GPUDevice,
    layout: GPUBindGroupLayout,
    resources: readonly unknown[],
    entries: () => GPUBindGroupEntry[],
  ) => {
    const { next } = identity
    next.length = 0
    next.push(layout, ...resources)
    if (identity.moved()) group = device.createBindGroup({ layout, entries: entries() })
    return group!
  }
}

/** What the groups of an image are made of. */
export interface PathTracingGroupInputs {
  readonly device: GPUDevice
  readonly gpu: PathTracingGpu
  readonly pipelines: PathTracingPipelines
  readonly rays: SceneRays
  /** The first level of the error chain of the image before, which the trace reads each pixel's samples from. */
  readonly variance: GPUTextureView
  /** The entries of the resolve's group 0 of the hits' shade, as `ensureWebgpuShadeBindings` lists them. */
  readonly resolve: GPUBindGroupEntry[]
  readonly shade: ReturnType<typeof hitShadePipelinesOf>
}

/** The bind groups of the path tracer's bounces: held across images, made again where a resource moved. */
export function createPathTracingGroups() {
  const caches = Object.fromEntries(
    ['trace0', 'trace1', 'finish0', 'finish1', 'shade0', 'shade1', 'argsView', 'argsOut'].map(
      (name) => [name, cachedGroup()],
    ),
  ) as Record<string, ReturnType<typeof cachedGroup>>
  const view = (gpu: PathTracingGpu) => ({ buffer: gpu.blocks, size: PT_VIEW.words * 4 })
  return (input: PathTracingGroupInputs) => {
    const { device, gpu, pipelines, rays, resolve, shade, variance } = input
    const B = PT_TRACE_BINDINGS
    const first = PT_TRACE_SCENE.first
    const scene = rays.sceneTrace
    const paths = () => [
      { binding: B.view, resource: view(gpu) },
      ...dagReadGroupEntries(rays.views),
      { binding: B.states, resource: { buffer: gpu.states } },
      { binding: B.queue, resource: { buffer: gpu.queue } },
    ]
    const sceneEntries = () => sceneTraceBindEntries(scene, first)
    const dag = [...Object.values(rays.views)]
    const trace0 = caches.trace0(
      device,
      pipelines.traceLayouts[0],
      [gpu.blocks, gpu.states, gpu.queue, variance, ...dag],
      () => [...paths(), { binding: B.variance, resource: variance }],
    )
    const trace1 = caches.trace1(
      device,
      pipelines.traceLayouts[1],
      [
        scene.params,
        scene.nodes,
        scene.triangles,
        scene.table,
        scene.corners,
        gpu.placements,
        gpu.hits,
      ],
      () => [
        ...sceneEntries(),
        sceneHitCornersBindEntry(scene, first + PT_TRACE_STAGE_BINDINGS.corners),
        {
          binding: first + PT_TRACE_STAGE_BINDINGS.placements,
          resource: { buffer: gpu.placements },
        },
        { binding: first + PT_TRACE_STAGE_BINDINGS.hits, resource: { buffer: gpu.hits } },
      ],
    )
    const finish0 = caches.finish0(
      device,
      pipelines.finishLayouts[0],
      [
        gpu.blocks,
        gpu.states,
        gpu.queue,
        gpu.lights,
        gpu.gridParams,
        gpu.gridView,
        gpu.gridDataView,
        gpu.skyView,
        gpu.skyPdfView,
        ...dag,
      ],
      () => [
        ...paths(),
        { binding: B.lights, resource: { buffer: gpu.lights } },
        { binding: B.gridParams, resource: { buffer: gpu.gridParams } },
        { binding: B.grid, resource: gpu.gridView },
        { binding: B.gridData, resource: gpu.gridDataView },
        { binding: B.skyTexture, resource: gpu.skyView },
        { binding: B.skyPdf, resource: gpu.skyPdfView },
      ],
    )
    const finish1 = caches.finish1(
      device,
      pipelines.finishLayouts[1],
      [scene.params, scene.nodes, scene.triangles, scene.table, gpu.hits, gpu.materials],
      () => [
        ...sceneEntries(),
        { binding: first + PT_FINISH_BINDINGS.hits, resource: { buffer: gpu.hits } },
        { binding: first + PT_FINISH_BINDINGS.materials, resource: { buffer: gpu.materials } },
      ],
    )
    const resolved: unknown[] = []
    entriesIdentity(resolve, resolved)
    const shade0 = caches.shade0(device, shade.layouts[0], resolved, () => resolve)
    const shade1 = caches.shade1(
      device,
      shade.layouts[1],
      [gpu.blocks, gpu.queue, gpu.hits, gpu.materials],
      () => [
        { binding: PT_SHADE_PATHS.view, resource: view(gpu) },
        { binding: PT_SHADE_PATHS.queue, resource: { buffer: gpu.queue } },
        { binding: PT_SHADE_PATHS.hits, resource: { buffer: gpu.hits } },
        { binding: PT_SHADE_PATHS.materials, resource: { buffer: gpu.materials } },
      ],
    )
    const argsView = caches.argsView(
      device,
      pipelines.argsLayouts[0],
      [gpu.blocks, gpu.queue],
      () => [
        { binding: PT_ARGS_BINDINGS.view, resource: view(gpu) },
        { binding: PT_ARGS_BINDINGS.queue, resource: { buffer: gpu.queue } },
      ],
    )
    const argsOut = caches.argsOut(device, pipelines.argsLayouts[1], [gpu.args], () => [
      { binding: PT_ARGS_BINDINGS.out, resource: { buffer: gpu.args } },
    ])
    return { trace0, trace1, finish0, finish1, shade0, shade1, argsView, argsOut }
  }
}

/** The entries of the resolve's group 0 the hits' shade keeps, from the resolve's own list (`shadeBindEntries`). */
export const hitShadeResolveEntries = (all: ReturnType<typeof shadeBindEntries>) =>
  all.filter((entry) => PT_SHADE_RESOURCE_BINDINGS.has(entry.binding))

export type PathTracingGroups = ReturnType<ReturnType<typeof createPathTracingGroups>>
