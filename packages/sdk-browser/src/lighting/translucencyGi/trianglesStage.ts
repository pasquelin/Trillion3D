import type { TranslucencyGiValues } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { dagReadGroupEntries } from '../../geometry/dag/shader/bindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { oncePerDeviceKey } from '../../gpu/core/oncePerDevice.ts'
import { startedTracedKernel } from '../bounce/cache/cacheKernels.ts'
import { TRACE_TRACED_HIT, TRACE_TRACED_SCENE } from '../bounce/screen/traceTracedWgsl.ts'
import { reflectionLayout } from '../reflections/reflectionPipelines.ts'
import { sceneTraceGroupBinder } from '../rays/sceneTrace/sceneTraceGroup.ts'
import { surfaceHitCardsEntries } from '../surfaceCache/hitWgsl.ts'
import { sceneRaysOf, type SceneRays } from '../surfaceCache/lighting/surfaceLighting.ts'
import type { TranslucencyGiState } from './gpu.ts'
import type { GiResources } from './resources.ts'
import type { GiTraceInputs } from './traceGroup.ts'
import {
  TRACE_GI_TRIANGLES_BINDINGS,
  TRACE_GI_TRIANGLES_ENTRY,
  traceGiTrianglesEntries,
  traceGiTrianglesProgram,
  traceGiTrianglesSceneEntries,
} from './traceTrianglesWgsl.ts'
import { TRACE_GI_LIGHT } from './traceWgsl.ts'

/**
 * THE KERNEL THAT CASTS THE CONES THROUGH THE SCENE'S TRIANGLES (`traceTrianglesWgsl.ts`) for cones' light of one format and a radiance cache stored in one
 * light format: compiled off the frame on the first ask and not waited for, apart from the volume's four kernels (`kernels.ts`) — a device that refuses it
 * leaves the volume as it is, the cones marched through the global distance field. Its layouts are its group 0 with the cut's tables, the reflection group
 * the cell's point is found with (the depth pyramid, the view) and the scene trace's.
 */
const kernelsOfLight = oncePerDeviceKey((_device: GPUDevice, light: LightAtlasFormat) =>
  oncePerDeviceKey((device: GPUDevice, format: GPUTextureFormat) => {
    const label = `Trillion3D translucency GI TRIANGLES ${format} ${light}`
    return startedTracedKernel(
      device,
      label,
      [
        device.createBindGroupLayout({ label, entries: traceGiTrianglesEntries(format, light) }),
        reflectionLayout(device),
        device.createBindGroupLayout({ label, entries: traceGiTrianglesSceneEntries() }),
      ],
      traceGiTrianglesProgram(format, light),
      TRACE_GI_TRIANGLES_ENTRY,
    )
  }),
)

/** The kernel on `device` for cones' light of `format` and a radiance cache stored in `light`: read once `ready`. */
export const trianglesKernel = (
  device: GPUDevice,
  format: GPUTextureFormat,
  light: LightAtlasFormat,
) => kernelsOfLight(device, light)(device, format)

/** The kernel that casts the cones through the scene's triangles. */
export type TrianglesKernel = ReturnType<typeof trianglesKernel>

/** The binder of the groups 0 and 2 of the kernel: over the volume's resources, what the trace reads of the image and the scene trace of the image
 *  (`SceneRays`) — each made again only where a resource it names moved. */
export function trianglesBinder(device: GPUDevice) {
  const identity = createWebgpuBindIdentity()
  const sceneGroup = sceneTraceGroupBinder(device)
  let group: GPUBindGroup | undefined
  return (
    kernel: TrianglesKernel,
    r: Pick<GiResources, 'frame' | 'cones'>,
    i: GiTraceInputs,
    rays: SceneRays,
  ) => {
    const { layouts } = kernel
    const { views } = rays
    const { hit } = i.reads
    const { next } = identity
    next[0] = layouts[0]
    next[1] = r.frame
    next[2] = r.cones[0]
    next[3] = i.params
    next[4] = i.bounceGrid
    next[5] = i.blue
    next[6] = views.nodes
    next[7] = views.frames
    next[8] = views.worlds
    next[9] = views.tree
    // The hit's resources, one by one: the object holding them is written in place each image (`hitCards.ts`).
    next[10] = hit.tables
    next[11] = hit.depth
    next[12] = hit.final
    next[13] = hit.instances
    if (identity.moved())
      group = device.createBindGroup({
        label: 'Trillion3D translucency GI triangles',
        layout: layouts[0],
        entries: [
          ...namedEntries(TRACE_GI_TRIANGLES_BINDINGS.at, {
            params: { buffer: i.params },
            frame: { buffer: r.frame },
            bounceGrid: { buffer: i.bounceGrid },
            blue: i.blue,
          }),
          { binding: TRACE_GI_LIGHT, resource: r.cones[0] },
          ...dagReadGroupEntries(views),
          ...surfaceHitCardsEntries(TRACE_TRACED_HIT, hit),
        ],
      })
    const scene = sceneGroup(
      layouts[TRACE_TRACED_SCENE.group],
      rays.sceneTrace,
      TRACE_TRACED_SCENE.first,
    )
    return [group!, scene] as const
  }
}

/** The cones' cast through the scene's triangles of an image, ready to dispatch: the scene trace it is made for, the pipeline and the groups 0 and 2. */
export interface TrianglesStage {
  readonly rays: SceneRays
  readonly pipeline: GPUComputePipeline
  readonly groups: readonly [GPUBindGroup, GPUBindGroup]
}

/**
 * Whether this image casts its cones through the scene's triangles (`translucencyGiHardwareRayTracing` with `translucencyGiTraceFromVolume`), and the
 * stage that does: the lighting made the scene trace for the image (`sceneRaysOf`) and the program is compiled; none otherwise, the cones are then
 * marched through the global distance field. Needs the state's resources and inputs of this image (`frame.ts`).
 */
export function trianglesStageOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  held: TranslucencyGiState,
  v: TranslucencyGiValues,
  format: GPUTextureFormat,
  light: LightAtlasFormat,
): TrianglesStage | undefined {
  if (!v.translucencyGiTraceFromVolume || !v.translucencyGiHardwareRayTracing) return undefined
  const rays = sceneRaysOf(rt.surfaceCache?.lighting, rt.run.frame)
  if (!rays) return undefined
  const kernel = trianglesKernel(device, format, light)
  if (!kernel.ready) return undefined
  held.triangles ??= trianglesBinder(device)
  return {
    rays,
    pipeline: kernel.pipeline(),
    groups: held.triangles(kernel, held.resources!, held.inputs, rays),
  }
}
