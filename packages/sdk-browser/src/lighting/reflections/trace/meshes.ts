import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import type { LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { hasSubgroups } from '../../../gpu/core/subgroups.ts'
import { hasFloat32Filterable } from '../../../gpu/core/float32Filterable.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import {
  meshStageOf,
  meshTraceSettingsOf,
  type MeshStageKernel,
  type MeshStageRun,
  type MeshStageState,
} from '../../bounce/screen/meshStage.ts'
import {
  traceMeshEntries,
  traceMeshListEntries,
  traceMeshParamsEntries,
} from '../../bounce/screen/traceMeshWgsl.ts'
import type { MeshDistanceFieldTraceSettings } from '../../../../../sdk-core/src/contracts/meshDistanceFieldTraceOptions.ts'
import type { ReflectionSettings } from '../../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { reflectionLayout } from '../reflectionPipelines.ts'
import { reflectionTraceShader } from './trace.ts'
import type { TraceLayouts } from './traceGroups.ts'

/**
 * THE KERNELS OF THE MESHES' FIELDS STAGE of the reflections (`meshesWgsl.ts`) for the surface cache's final light stored in `light`: the first compaction and the trace, both from one module of the
 * reflection's program (`reflectionTraceShader` with `meshes`) and over the opaque surface (the layer 0). Each is over the trace's group 0 of its own (`meshCompact`, `meshTrace`), the reflection
 * group, the meshes' fields and the grid's group 2 and the list of the rays traced in a group 3 — the shape the screen probes' stage has, so one `meshStageOf` makes the grid and the groups of both. Compiled off the
 * frame and not waited for: until they are `ready` the rays go to the scene stage as the screen left them.
 */
export function reflectionMeshKernel(
  device: GPUDevice,
  layouts: TraceLayouts,
  light: LightAtlasFormat,
): MeshStageKernel {
  const label = 'Trillion3D reflection meshes'
  const module = device.createShaderModule({
    label,
    code: reflectionTraceShader(
      false,
      false,
      'none',
      light,
      hasSubgroups(device) ? 'native' : 'polyfill',
      undefined,
      undefined,
      hasFloat32Filterable(device.features),
    ),
  })
  const group = device.createBindGroupLayout({ label, entries: traceMeshEntries() })
  const paramsGroup = device.createBindGroupLayout({
    label: `${label} grid`,
    entries: traceMeshParamsEntries(),
  })
  // Each half keeps its compiled stage itself: what it holds is read live (`ready` turns true once it is compiled), never copied.
  const half = (compaction: boolean) => {
    const entry = compaction ? 'compactReflectionMeshes' : 'traceReflectionMeshes'
    const list = device.createBindGroupLayout({
      label: `${label} ${compaction ? 'written' : 'read'} list`,
      entries: traceMeshListEntries(compaction),
    })
    const stages = startedComputeStages(
      device,
      `${label} ${compaction ? 'compaction' : 'trace'}`,
      device.createPipelineLayout({
        bindGroupLayouts: [
          compaction ? layouts.meshCompact : layouts.meshTrace,
          reflectionLayout(device),
          compaction ? paramsGroup : group,
          list,
        ],
      }),
      module,
      [entry],
      { REFLECTION_LAYER: 0 },
    )
    return {
      list,
      get ready() {
        return stages.ready
      },
      pipeline: () => stages.pipelineOf(entry),
    }
  }
  const compact = half(true),
    trace = half(false)
  return {
    group,
    paramsGroup,
    compact,
    trace,
    get ready() {
      return compact.ready && trace.ready
    },
  }
}

/** The kernels made, by the layouts they were made over (a view's kernels follow the format of the cache's final light: the layouts are those of one). */
const kernels = new WeakMap<TraceLayouts, MeshStageKernel>()

/**
 * Whether this image traces the meshes' fields for the reflections: the project's switch and the quality's allowance, the view's detail flag (`meshDistanceFieldTrace`), the reflections' own
 * (`reflectionMeshDistanceFieldTrace`), the scene traces, and a scene stage that marches the global field (not one through the scene's triangles).
 */
export const wantsReflectionMeshes = (
  trace: MeshDistanceFieldTraceSettings,
  sceneTraces: boolean,
  traced: boolean,
) => sceneTraces && !traced && trace.enabled && trace.reflections

/**
 * THE MESHES' FIELDS STAGE OF THIS IMAGE's OPAQUE REFLECTIONS: the scene's meshes culled to the view's grid (`meshStageOf`) and the stage's pipelines and groups, or none while the trace is off, the scene
 * stage casts through triangles, or any resource is not ready (the kernels compile on the first image that asks, not waited for).
 */
export function reflectionMeshesOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: MeshStageState,
  stages: { layouts: TraceLayouts; light: LightAtlasFormat },
  settings: Pick<ReflectionSettings, 'sceneTraces'>,
  traced: boolean,
  viewProjection: ArrayLike<number>,
  rays: GPUBuffer | undefined,
): MeshStageRun | undefined {
  const trace = meshTraceSettingsOf(rt)
  if (!rays || !wantsReflectionMeshes(trace, settings.sceneTraces, traced)) return undefined
  // The view's one grid: the screen probes' (where they keep one), so the meshes are culled once for both.
  if (rt.bounce.screen) state.grid = rt.bounce.screen.meshes.grid
  let kernel = kernels.get(stages.layouts)
  if (!kernel)
    kernels.set(
      stages.layouts,
      (kernel = reflectionMeshKernel(device, stages.layouts, stages.light)),
    )
  return meshStageOf(rt, device, encoder, state, kernel, trace, viewProjection, rays)
}

/** The groups of the lists of the rays traced (written by the first compaction, read by the trace) over a buffer, kept for the buffer. */
const listGroups = new WeakMap<GPUBuffer, [GPUBindGroup, GPUBindGroup]>()

/**
 * The groups of the list of the rays traced for a surface of its own buffer `rays` (a closure past the first, whose grids hold a list of their own), the stage's pipelines and group 2 (`reflectionMeshesOf`) being the
 * view's: none while the stage's kernels are not made.
 */
export function reflectionMeshLists(layouts: TraceLayouts, device: GPUDevice, rays: GPUBuffer) {
  const kernel = kernels.get(layouts)
  if (!kernel) return undefined
  let held = listGroups.get(rays)
  if (!held) {
    held = [kernel.compact, kernel.trace].map(({ list }) =>
      device.createBindGroup({
        layout: list,
        entries: [{ binding: 0, resource: { buffer: rays } }],
      }),
    ) as [GPUBindGroup, GPUBindGroup]
    listGroups.set(rays, held)
  }
  return held
}
