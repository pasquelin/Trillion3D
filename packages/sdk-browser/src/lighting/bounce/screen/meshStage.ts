import {
  MESH_DISTANCE_FIELD_TRACE_RULES,
  resolveMeshDistanceFieldTrace,
  type MeshDistanceFieldTraceSettings,
} from '../../../../../sdk-core/src/contracts/meshDistanceFieldTraceOptions.ts'
import {
  resolveSettings,
  resolveSettingsStamped,
} from '../../../../../sdk-core/src/contracts/settingRules.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { noiseFrame } from '../../../frame/render/noiseFrame.ts'
import { createWebgpuBindIdentity } from '../../../gpu/bind/bindIdentity.ts'
import { reflectionSceneLayout } from '../../reflections/reflectionPipelines.ts'
import {
  encodeMeshGrid,
  type MeshGridHeld,
  type MeshGridInputs,
} from '../../rays/meshTrace/gridPasses.ts'
import { MESH_TRACE_BINDING } from '../../rays/meshTrace/traceWgsl.ts'
import { startedTracedKernel } from '../cache/cacheKernels.ts'
import { raysKey, type CastKernels, type KernelShape } from './kernels.ts'
import { hasSubgroups } from '../../../gpu/core/subgroups.ts'
import {
  compactMeshShader,
  traceMeshEntries,
  traceMeshListEntries,
  traceMeshParamsEntries,
  traceMeshShader,
} from './traceMeshWgsl.ts'

/** The meshes' fields trace's settings, read by the stamped reader into this one object. */
const values = resolveSettings(MESH_DISTANCE_FIELD_TRACE_RULES, {})

/** The settings of the meshes' fields trace of the view (`meshDistanceFieldTrace*`, off by default as the reference's project setting is). */
export function meshTraceSettingsOf(rt: WebgpuPagesRuntime): MeshDistanceFieldTraceSettings {
  resolveSettingsStamped(MESH_DISTANCE_FIELD_TRACE_RULES, rt.context, values)
  return resolveMeshDistanceFieldTrace(values)
}

/**
 * THE KERNELS OF THE MESHES' FIELDS STAGE for the rays a side of a probe, the samples of a tile and the fog of `shape` (`traceMeshesBlock`, `compactMeshesBlock`): the first compaction (`compact`) and the trace
 * (`trace`), each over the scene stage's group 0, the reflection group the scene stages read, the group 2 they share and the list of the rays traced in a group 3 of its own (written by the first, read by the
 * second). Compiled off the frame and not waited for (the store keeps it, `ScreenProbeStore.meshesFor`): until they are `ready` the rays are marched through the global distance field alone, as they are where
 * the meshes' fields are not traced.
 */
export function meshStageKernel(
  device: GPUDevice,
  shape: Pick<KernelShape, 'side' | 'samples' | 'heightFog' | 'light'>,
  kernels: Pick<CastKernels, 'traceScene'>,
) {
  const label = `Trillion3D SCREEN_PROBE_MESHES ${raysKey(shape)}|${shape.light}`
  const group = device.createBindGroupLayout({ label, entries: traceMeshEntries() })
  // The first compaction reads the grid's uniform alone.
  const paramsGroup = device.createBindGroupLayout({
    label: `${label} grid`,
    entries: traceMeshParamsEntries(),
  })
  const compaction = hasSubgroups(device) ? 'native' : 'polyfill'
  // Each stage keeps the started kernel itself: what it holds is read live (`ready` turns true once it is compiled), never copied.
  const stage = (write: boolean) => {
    const list = device.createBindGroupLayout({
      label: `${label} ${write ? 'written' : 'read'} list`,
      entries: traceMeshListEntries(write),
    })
    const started = startedTracedKernel(
      device,
      `${label} ${write ? 'compaction' : 'trace'}`,
      [kernels.traceScene.layout, reflectionSceneLayout(device), write ? paramsGroup : group, list],
      write
        ? compactMeshShader(shape.side, shape.samples, compaction)
        : traceMeshShader(shape.side, shape.samples, shape.heightFog, shape.light),
      write ? 'compactMeshRays' : 'traceMeshes',
    )
    return {
      list,
      get ready() {
        return started.ready
      },
      pipeline: started.pipeline,
    }
  }
  const compact = stage(true),
    trace = stage(false)
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

/** The compiled kernel of the meshes' stage (`meshStageKernel`). */
export type MeshStageKernel = ReturnType<typeof meshStageKernel>

/** What the stage dispatches with: the pipelines of its first compaction and its trace, each with its group 2 (`TRACE_MESH_GROUP`) and the group of the list of the rays traced
 *  (`TRACE_MESH_LIST`). */
export interface MeshStageRun {
  compact: { pipeline: GPUComputePipeline; group: GPUBindGroup; list: GPUBindGroup }
  trace: { pipeline: GPUComputePipeline; group: GPUBindGroup; list: GPUBindGroup }
}

/** What a view keeps of the meshes' stage between two images: the grid's resources (`encodeMeshGrid`), the group 2 made over them and the groups of the list of the rays traced (written, read). */
export interface MeshStageState {
  grid: MeshGridHeld
  group: GPUBindGroup | undefined
  lists: [GPUBindGroup, GPUBindGroup] | undefined
  paramsGroup: GPUBindGroup | undefined
  identity: ReturnType<typeof createWebgpuBindIdentity>
}

/** A view's meshes' stage state, none yet. */
export const newMeshStageState = (): MeshStageState => ({
  grid: { view: undefined, why: undefined },
  group: undefined,
  lists: undefined,
  paramsGroup: undefined,
  identity: createWebgpuBindIdentity(),
})

/**
 * Whether this image traces the meshes' fields for the screen probes (`meshDistanceFieldTrace`, the quality's allowance, the view's detail flag and `screenProbeMeshDistanceFieldTrace`), the probes
 * tracing the scene through the global distance field and not the scene's triangles.
 */
export const wantsMeshStage = (
  trace: MeshDistanceFieldTraceSettings,
  sceneTraces: boolean,
  traced: boolean,
) => sceneTraces && !traced && trace.enabled && trace.screenProbes

/**
 * THE MESHES' FIELDS STAGE OF THIS IMAGE: the scene's meshes culled to the view's grid (`encodeMeshGrid`) and the stage's pipeline and group 2, or none where the scene has no meshes' fields or the
 * grid's or the stage's resources are not ready (the rays then go to the global field alone).
 */
export function meshStageOf(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  state: MeshStageState,
  kernel: MeshStageKernel,
  settings: MeshDistanceFieldTraceSettings,
  viewProjection: ArrayLike<number>,
  rays: GPUBuffer,
): MeshStageRun | undefined {
  const scene = rt.distanceFields?.scene
  const depth = rt.vis.gpuHiz?.depth()
  if (!scene || !depth || !kernel.ready) return undefined
  const { cam } = rt.run.gate
  const objects = scene.meshes
  const inputs: MeshGridInputs = {
    depth,
    objects,
    image: {
      view: rt.gpu.targetSize,
      extent: rt.gpu.allocatedSize,
      viewProjection,
      world: cam.world,
      projection: cam.projection,
      near: cam.near,
      far: cam.far,
      perspective: cam.perspective !== 0,
      frame: noiseFrame(rt) % 8,
    },
    settings,
    endDistance: settings.endDistance,
    traceDistance: settings.traceDistance,
    // The view's scene detail (the radius threshold is divided by it): the full detail.
    sceneDetail: 1,
  }
  const lists = encodeMeshGrid(device, encoder, state.grid, inputs)
  if (!lists) return undefined
  const { next } = state.identity
  next[0] = objects.generation
  next[1] = lists.params
  next[2] = lists.cells
  next[3] = lists.indices
  next[4] = kernel.group
  next[5] = rays
  if (state.identity.moved() || !state.group || !state.paramsGroup || !state.lists) {
    state.paramsGroup = device.createBindGroup({
      layout: kernel.paramsGroup,
      entries: [{ binding: MESH_TRACE_BINDING.params, resource: { buffer: lists.params } }],
    })
    state.lists = [kernel.compact, kernel.trace].map(({ list }) =>
      device.createBindGroup({
        layout: list,
        entries: [{ binding: 0, resource: { buffer: rays } }],
      }),
    ) as [GPUBindGroup, GPUBindGroup]
    state.group = device.createBindGroup({
      layout: kernel.group,
      entries: [
        ...objects.bindEntries(0),
        { binding: MESH_TRACE_BINDING.params, resource: { buffer: lists.params } },
        { binding: MESH_TRACE_BINDING.cells, resource: { buffer: lists.cells } },
        { binding: MESH_TRACE_BINDING.indices, resource: { buffer: lists.indices } },
      ],
    })
  }
  return {
    compact: {
      pipeline: kernel.compact.pipeline(),
      group: state.paramsGroup,
      list: state.lists[0],
    },
    trace: { pipeline: kernel.trace.pipeline(), group: state.group, list: state.lists[1] },
  }
}
