import { dagReadGroupEntries } from '../../geometry/dag/shader/bindings.ts'
import { createCachedGroup } from '../../gpu/bind/cachedGroup.ts'
import { entriesIdentity } from '../../gpu/bind/entriesIdentity.ts'
import { shadeBindEntries } from '../../gpu/bind/bindEntries.ts'
import {
  sceneTraceGroupEntries,
  sceneTraceGroupResources,
} from '../rays/sceneTrace/sceneTraceGroup.ts'
import type { SceneTrace } from '../rays/sceneTrace/sceneTraceResources.ts'
import type { SceneRays } from '../surfaceCache/lighting/surfaceLighting.ts'
import { PT_AIR_BINDINGS } from './airMediumWgsl.ts'
import { cloudResources, shifted, type PathTracingClouds } from './cloudFrame.ts'
import { PT_CLOUD_BINDINGS } from './cloudMediumWgsl.ts'
import { PT_ARGS_BINDINGS } from './argsProgram.ts'
import { PT_FINISH_BINDINGS } from './finishWgsl.ts'
import type { PathTracingGpu } from './gpuState.ts'
import type { PathTracingPipelines } from './pipelines.ts'
import { PT_SHADE_RESOURCE_BINDINGS, type hitShadePipelinesOf } from './shadeHitPipelines.ts'
import { PT_SHADE_PATHS } from './shadeHitWgsl.ts'
import { PT_TRACE_STAGE_BINDINGS } from './traceBounceWgsl.ts'
import { PT_TRACE_BINDINGS, PT_TRACE_SCENE } from './traceProgram.ts'
import { PT_VIEW } from './viewWgsl.ts'

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
  /** The clouds the paths trace in this image, none where they are not: the first group of the trace and of the finish also binds the cloud material, the clouds' block and the acceleration map. */
  readonly clouds: PathTracingClouds | undefined
}

/** The bind groups of the path tracer's bounces: held across images, made again where a resource moved. */
export function createPathTracingGroups() {
  const caches = Object.fromEntries(
    ['trace0', 'trace1', 'finish0', 'finish1', 'shade0', 'shade1', 'argsView', 'argsOut'].map(
      // The first group of the trace and of the finish names the cloud map image, which takes turns with the one before it: a group for each.
      (name) => [name, createCachedGroup(name === 'trace0' || name === 'finish0' ? 2 : 1)],
    ),
  ) as Record<string, ReturnType<typeof createCachedGroup>>
  const view = (gpu: PathTracingGpu) => ({ buffer: gpu.blocks, size: PT_VIEW.words * 4 })
  // The names of a group are copied by its cache as it is asked: one list serves every group.
  const named: unknown[] = []
  const withScene = (scene: SceneTrace, first: unknown, second: unknown) => {
    sceneTraceGroupResources(scene, named).push(first, second)
    return named
  }
  return (input: PathTracingGroupInputs) => {
    const { device, gpu, pipelines, rays, resolve, shade, variance, clouds } = input
    const B = PT_TRACE_BINDINGS
    const first = PT_TRACE_SCENE.first
    const scene = rays.sceneTrace
    const paths = () => [
      { binding: B.view, resource: view(gpu) },
      ...dagReadGroupEntries(rays.views),
      { binding: B.states, resource: { buffer: gpu.states } },
      { binding: B.queue, resource: { buffer: gpu.queue } },
      { binding: PT_AIR_BINDINGS.atmosphere, resource: { buffer: gpu.atmosphere } },
      { binding: PT_AIR_BINDINGS.depth, resource: gpu.airDepthView },
      ...(clouds
        ? [
            { binding: PT_CLOUD_BINDINGS.params, resource: { buffer: gpu.cloud } },
            { binding: PT_CLOUD_BINDINGS.map, resource: gpu.cloudMapViews[gpu.cloudWritten]! },
            ...shifted(clouds.entries, PT_CLOUD_BINDINGS.material),
          ]
        : []),
    ]
    const cloudResourceList = clouds ? cloudResources(gpu, clouds) : []
    const sceneEntries = () => sceneTraceGroupEntries(scene, first)
    const dag = [...Object.values(rays.views)]
    const trace0 = caches.trace0(
      device,
      pipelines.traceLayouts[0],
      [
        gpu.blocks,
        gpu.states,
        gpu.queue,
        gpu.atmosphere,
        gpu.airDepthView,
        variance,
        ...dag,
        ...cloudResourceList,
      ],
      () => [...paths(), { binding: B.variance, resource: variance }],
    )
    const trace1 = caches.trace1(
      device,
      pipelines.traceLayouts[1],
      withScene(scene, gpu.placements, gpu.hits),
      () => [
        ...sceneEntries(),
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
        gpu.atmosphere,
        gpu.airDepthView,
        ...dag,
        ...cloudResourceList,
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
      withScene(scene, gpu.hits, gpu.materials),
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
