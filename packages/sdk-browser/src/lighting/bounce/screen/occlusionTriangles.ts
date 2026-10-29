import type { ScreenProbeSettings } from '../../../../../sdk-core/src/bounce/screenProbeOptions.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { dagReadGroupEntries } from '../../../geometry/dag/shader/bindings.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../../gpu/core/computeBindings.ts'
import { startedTracedKernel } from '../cache/cacheKernels.ts'
import { sceneTraceGroupBinder } from '../../rays/sceneTrace/sceneTraceGroup.ts'
import { reflectionLayout } from '../../reflections/reflectionPipelines.ts'
import { sceneRaysOf, type SceneRays } from '../../surfaceCache/lighting/surfaceLighting.ts'
import type { GroupParts } from './groupParts.ts'
import { kernelShapeOf } from './kernels.ts'
import {
  OCCLUSION_TRIANGLES_BINDINGS,
  OCCLUSION_TRIANGLES_ENTRY,
  OCCLUSION_TRIANGLES_SCENE,
  occlusionTrianglesEntries,
  occlusionTrianglesProgram,
  occlusionTrianglesSceneEntries,
} from './occlusionTrianglesWgsl.ts'

/** The kernels made, by device and by what they are made for: the occlusion's shape, a probe's samples, the rays a pixel casts and the bias they start at. */
const made = new WeakMap<GPUDevice, Map<string, ReturnType<typeof startedTracedKernel>>>()

/**
 * The kernel that casts the short-range occlusion through the scene's triangles (`occlusionTrianglesWgsl.ts`) for the occlusion of `settings`, compiled off the
 * frame on the first ask and not waited for: until it is `ready` the occlusion is the horizon search's (or the screen's rays'). Its layouts are its group 0 with
 * the cut's tables, the reflection group and the scene trace's.
 */
function occlusionTrianglesKernel(device: GPUDevice, settings: ScreenProbeSettings) {
  const { occlusion, samples } = kernelShapeOf(settings)
  const rays = settings.occlusionTriangleRays,
    bias = settings.occlusionTriangleBias
  const key = `${samples.join('x')}|${occlusion.downsample}|${occlusion.bentNormal}|${rays}|${bias}`
  let byKey = made.get(device)
  if (!byKey) made.set(device, (byKey = new Map()))
  let kernel = byKey.get(key)
  if (!kernel) {
    const label = `Trillion3D screen probe occlusion TRIANGLES ${key}`
    byKey.set(
      key,
      (kernel = startedTracedKernel(
        device,
        label,
        [
          device.createBindGroupLayout({
            label,
            entries: occlusionTrianglesEntries(occlusion.bentNormal),
          }),
          reflectionLayout(device),
          device.createBindGroupLayout({ label, entries: occlusionTrianglesSceneEntries() }),
        ],
        occlusionTrianglesProgram(occlusion, samples, rays, bias),
        OCCLUSION_TRIANGLES_ENTRY,
      )),
    )
  }
  return kernel
}

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
): OcclusionTrianglesStage | undefined {
  if (!settings.occlusionTriangles) return undefined
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  if (!rays) return undefined
  const kernel = occlusionTrianglesKernel(device, settings)
  if (!kernel.ready) return undefined
  return { rays, pipeline: kernel.pipeline(), groups: bind(kernel.layouts, rays) }
}
