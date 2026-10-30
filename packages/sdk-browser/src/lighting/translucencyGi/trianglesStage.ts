import {
  heldMakerOf,
  oncePerDeviceOverPrograms,
  sceneMaskKey,
} from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { isPending, isReady } from '../rays/sceneTrace/sceneMaskHold.ts'
import type { TranslucencyGiValues } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { dagReadGroupEntries } from '../../geometry/dag/shader/bindings.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { namedEntries } from '../../gpu/core/computeBindings.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
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
  TRIANGLES_CELL_TABLE,
  traceGiTrianglesEntries,
  traceGiTrianglesProgram,
  traceGiTrianglesSceneEntries,
} from './traceTrianglesWgsl.ts'
import { TRACE_GI_LIGHT } from './traceWgsl.ts'

/**
 * THE KERNEL THAT TRACES THE CONES THROUGH THE SCENE'S TRIANGLES (`traceTrianglesWgsl.ts`) for cones' light of one format and a radiance cache stored in one
 * light format, which reads the radiance cache for the cones that meet nothing: compiled off the frame on the first ask and not waited for, apart from the volume's four kernels (`kernels.ts`) — until it is ready, or on a device that refuses it,
 * the volume traces its cones through the global distance field (`traceCones`). Its layouts are its group 0 with the cut's tables and the radiance cache's maps, the reflection group
 * the cell's point is found with (the depth pyramid, the view) and the scene trace's.
 */
const trianglesKernels = oncePerDeviceOverPrograms(
  (device: GPUDevice, key: `${GPUTextureFormat} ${LightAtlasFormat}`, programs) => {
    const [format, light] = key.split(' ') as [GPUTextureFormat, LightAtlasFormat]
    const label = `Trillion3D translucency GI TRIANGLES ${format} ${light} ${sceneMaskKey(programs)}`
    return startedTracedKernel(
      device,
      label,
      [
        device.createBindGroupLayout({ label, entries: traceGiTrianglesEntries(format, light) }),
        reflectionLayout(device),
        device.createBindGroupLayout({ label, entries: traceGiTrianglesSceneEntries() }),
      ],
      traceGiTrianglesProgram(format, light, programs),
      TRACE_GI_TRIANGLES_ENTRY,
    )
  },
)
const trianglesMaker = heldMakerOf(trianglesKernels)

/** The kernel that casts the cones through the scene's triangles. */
export type TrianglesKernel = ReturnType<typeof trianglesKernels>

/** The binder of the groups 0 and 2 of the kernel: over the volume's resources, what the trace reads of the image (the cascades, the radiance cache's maps) and the scene trace of the image
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
    next[14] = i.probes
    next[15] = i.cacheFinal
    next[16] = i.cacheRaw
    next[17] = i.cacheSky
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
            cacheFinal: i.cacheFinal,
            cacheRaw: i.cacheRaw,
            cacheSky: i.cacheSky,
          }),
          { binding: TRIANGLES_CELL_TABLE, resource: i.probes },
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

/** The cones' trace through the scene's triangles of an image, ready to dispatch in place of `traceCones`: the scene trace it is made for, the pipeline and the groups 0 and 2. */
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
  const key = `${format} ${light}` as const
  const kernel = rays.sceneTrace.maskHold.use(
    'translucency gi',
    key,
    trianglesMaker(device, key),
    isReady,
    isPending,
  )?.kernel
  if (!kernel?.ready) return undefined
  held.triangles ??= trianglesBinder(device)
  return {
    rays,
    pipeline: kernel.pipeline(),
    groups: held.triangles(kernel, held.resources!, held.inputs, rays),
  }
}
