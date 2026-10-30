import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import { isPending, isReady } from '../../rays/sceneTrace/sceneMaskHold.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { startedTracedKernel } from '../cache/cacheKernels.ts'
import {
  heldMakerOf,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import { sceneRaysOf, type SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import type { GroupParts } from './groupParts.ts'
import { kernelShapeOf } from './kernels.ts'
import {
  OCCLUSION_TRIANGLES_BINDINGS,
  OCCLUSION_TRIANGLES_ENTRY,
  OCCLUSION_TRIANGLES_OVERFLOW_BINDING,
  OCCLUSION_TRIANGLES_SCENE,
  occlusionTrianglesEntries,
  occlusionTrianglesProgram,
  occlusionTrianglesSceneEntries,
} from './occlusionTrianglesWgsl.ts'

/** What the kernels of a device are made of, by key (`occlusionTrianglesOf`): kept by the first image to ask, since the key tells everything the kernel is made of; plain data, never the settings it came from. An entry goes when the hold forgets the pass that names it. */
const shapes = new WeakMap<GPUDevice, Map<string, OcclusionTrianglesShape>>()

/**
 * What tells apart the kernels made for the occlusion of `settings`, whatever the programs (`key`), and what the kernel is made of (`shape`, out of the settings, which a maker does not
 * keep): both out of one reading of the settings.
 */
function occlusionTrianglesOf(settings: ScreenProbeSettings, overflow = false) {
  const { occlusion, samples } = kernelShapeOf(settings)
  const rays = settings.occlusionTriangleRays,
    bias = settings.occlusionTriangleBias
  return {
    key: `${samples.join('x')}|${occlusion.downsample}|${occlusion.bentNormal}|${rays}|${bias}${overflow ? '|overflow' : ''}`,
    shape: { occlusion, samples, rays, bias, overflow },
  }
}

type OcclusionTrianglesShape = ReturnType<typeof occlusionTrianglesOf>['shape']

/**
 * The kernel that casts the short-range occlusion through the scene's triangles (`occlusionTrianglesWgsl.ts`) for the occlusion of `shape`, compiled off the
 * frame on the first ask and not waited for: until it is `ready` the occlusion is the horizon search's (or the screen's rays'). Its layouts are its group 0 with
 * the cut's tables, the reflection group and the scene trace's.
 */
const occlusionTrianglesKernel = oncePerDeviceOverPrograms(
  (device: GPUDevice, key: string, programs: SceneMaskPrograms) => {
    const { occlusion, samples, rays, bias, overflow } = shapes.get(device)!.get(key)!
    const label = `Trillion3D screen probe occlusion TRIANGLES ${key}|${sceneMaskKey(programs)}`
    return startedTracedKernel(
      device,
      label,
      [
        device.createBindGroupLayout({
          label,
          entries: occlusionTrianglesEntries(occlusion.bentNormal, overflow),
        }),
        reflectionLayout(device),
        device.createBindGroupLayout({ label, entries: occlusionTrianglesSceneEntries() }),
      ],
      occlusionTrianglesProgram(occlusion, samples, rays, bias, programs, overflow),
      OCCLUSION_TRIANGLES_ENTRY,
    )
  },
)

const occlusionTrianglesMaker = heldMakerOf(occlusionTrianglesKernel, (device, key) =>
  shapes.get(device)?.delete(key),
)

/** The binder of the groups 0 and 2 of the kernel, over the image's surfaces and the scene trace of the image (`SceneRays`): each made again only where a resource it names moved. */
export function occlusionTrianglesBinder(g: GroupParts) {
  const { device, r, inputs, common, surface } = g
  const identity = createWebgpuBindIdentity()
  const sceneGroup = sceneTraceGroupBinder(device)
  let group: GPUBindGroup | undefined
  return (layouts: readonly GPUBindGroupLayout[], rays: SceneRays) => {
    const { views } = rays
    identity.next[0] = layouts[0]
    identity.next[1] = views.nodes
    identity.next[2] = views.frames
    identity.next[3] = views.worlds
    identity.next[4] = views.tree
    identity.next[5] = g.overflow?.buffer
    if (identity.moved())
      group = device.createBindGroup({
        label: 'Trillion3D screen probe occlusion triangles',
        layout: layouts[0],
        entries: [
          ...namedEntries(OCCLUSION_TRIANGLES_BINDINGS.at, {
            ...common,
            ...surface,
            occlusion: r.occlusion,
            blue: inputs.blue,
          }),
          ...(g.overflow
            ? [{ binding: OCCLUSION_TRIANGLES_OVERFLOW_BINDING, resource: g.overflow }]
            : []),
          ...dagReadGroupEntries(views),
        ],
      })
    const scene = sceneGroup(
      layouts[OCCLUSION_TRIANGLES_SCENE.group],
      rays.sceneTrace,
      OCCLUSION_TRIANGLES_SCENE.first,
    )
    return [group!, scene] as const
  }
}

/** The occlusion's pass through the scene's triangles of an image, ready to dispatch: the scene trace it is made for, the pipeline and the groups 0 and 2. */
export interface OcclusionTrianglesStage {
  readonly rays: SceneRays
  readonly pipeline: GPUComputePipeline
  readonly groups: readonly [GPUBindGroup, GPUBindGroup]
  /** The pass over the overflow tiles of the closures past the first, once compiled: its pipeline and the groups 0 and 2 of each closure, over the closure's own textures and its region of the closure tiles' list (none for a closure whose region is not there). */
  readonly overflow?: {
    readonly pipeline: GPUComputePipeline
    readonly closures: readonly (readonly [GPUBindGroup, GPUBindGroup] | undefined)[]
  }
}

/**
 * Whether this image casts its short-range occlusion through the scene's triangles (`screenProbeShortRangeAOHardwareRayTracing`), and the stage that does: the
 * lighting made the scene trace for the image (`sceneRaysOf`) and the program is compiled; none otherwise.
 */
export function occlusionTrianglesStageOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  settings: ScreenProbeSettings,
  bind: ReturnType<typeof occlusionTrianglesBinder>,
  closureBinds: readonly (ReturnType<typeof occlusionTrianglesBinder> | undefined)[] = [],
): OcclusionTrianglesStage | undefined {
  if (!settings.occlusionTriangles) return undefined
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  if (!rays) return undefined
  const { key, shape } = occlusionTrianglesOf(settings)
  let ofDevice = shapes.get(device)
  if (!ofDevice) shapes.set(device, (ofDevice = new Map()))
  if (!ofDevice.has(key)) ofDevice.set(key, shape)
  const kernel = rays.sceneTrace.maskHold.use(
    'screen occlusion',
    key,
    occlusionTrianglesMaker(device, key),
    isReady,
    isPending,
  )?.kernel
  if (!kernel?.ready) return undefined
  return {
    rays,
    pipeline: kernel.pipeline(),
    groups: bind(kernel.layouts, rays),
    overflow: overflowStageOf(device, settings, rays, closureBinds),
  }
}

/** The pass over the overflow tiles of the closures past the first, where the view has any (`closureBinds`) and its kernel is compiled: asked beside the first closure's, and not waited for (until it is ready those closures' occlusion is the horizon search's). */
function overflowStageOf(
  device: GPUDevice,
  settings: ScreenProbeSettings,
  rays: SceneRays,
  closureBinds: readonly (ReturnType<typeof occlusionTrianglesBinder> | undefined)[],
): OcclusionTrianglesStage['overflow'] {
  if (!closureBinds.length) return undefined
  const { key, shape } = occlusionTrianglesOf(settings, true)
  const ofDevice = shapes.get(device)!
  if (!ofDevice.has(key)) ofDevice.set(key, shape)
  const kernel = rays.sceneTrace.maskHold.use(
    'screen occlusion overflow',
    key,
    occlusionTrianglesMaker(device, key),
    isReady,
    isPending,
  )?.kernel
  if (!kernel?.ready) return undefined
  return {
    pipeline: kernel.pipeline(),
    closures: closureBinds.map((bindClosure) => bindClosure?.(kernel.layouts, rays)),
  }
}
