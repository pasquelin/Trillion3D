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
import { encodeMeshGrid, type MeshGridInputs } from '../../rays/meshTrace/gridPasses.ts'
import { MESH_TRACE_BINDING } from '../../rays/meshTrace/traceWgsl.ts'
import { startedTracedKernel } from '../cache/cacheKernels.ts'
import { raysKey, type CastKernels, type KernelShape } from './kernels.ts'
import { traceMeshEntries, traceMeshShader } from './traceMeshWgsl.ts'

/** The meshes' fields trace's settings, read by the stamped reader into this one object. */
const values = resolveSettings(MESH_DISTANCE_FIELD_TRACE_RULES, {})

/** The settings of the meshes' fields trace of the view (`meshDistanceFieldTrace*`, off by default as the reference's project setting is). */
export function meshTraceSettingsOf(rt: WebgpuPagesRuntime): MeshDistanceFieldTraceSettings {
  resolveSettingsStamped(MESH_DISTANCE_FIELD_TRACE_RULES, rt.context, values)
  return resolveMeshDistanceFieldTrace(values)
}

/**
 * THE KERNEL OF THE MESHES' FIELDS STAGE for the rays a side of a probe, the samples of a tile and the fog of `shape` (`traceMeshesBlock`): its layouts are the scene stage's group 0, the reflection
 * group the scene stages read and its own group 2. Compiled off the frame and not waited for (the store keeps it, `ScreenProbeStore.meshesFor`): until it is `ready` the rays are marched through the
 * global distance field alone, as they are where the meshes' fields are not traced.
 */
export function meshStageKernel(
  device: GPUDevice,
  shape: Pick<KernelShape, 'side' | 'samples' | 'heightFog' | 'light'>,
  kernels: Pick<CastKernels, 'traceScene'>,
) {
  const label = `Trillion3D SCREEN_PROBE_MESHES ${raysKey(shape)}|${shape.light}`
  const group = device.createBindGroupLayout({ label, entries: traceMeshEntries() })
  return {
    group,
    ...startedTracedKernel(
      device,
      label,
      [kernels.traceScene.layout, reflectionSceneLayout(device), group],
      traceMeshShader(shape.side, shape.samples, shape.heightFog, shape.light),
      'traceMeshes',
    ),
  }
}

/** The compiled kernel of the meshes' stage (`meshStageKernel`). */
export type MeshStageKernel = ReturnType<typeof meshStageKernel>

/** What the stage dispatches with: its pipeline and its group 2 (`TRACE_MESH_GROUP`). */
export interface MeshStageRun {
  pipeline: GPUComputePipeline
  group: GPUBindGroup
}

/** What a view keeps of the meshes' stage between two images: the grid's resources (`encodeMeshGrid`) and the group 2 made over them. */
export interface MeshStageState {
  grid: Parameters<typeof encodeMeshGrid>[2]
  group: GPUBindGroup | undefined
  identity: ReturnType<typeof createWebgpuBindIdentity>
}

/** A view's meshes' stage state, none yet. */
export const newMeshStageState = (): MeshStageState => ({
  grid: { view: undefined, why: undefined },
  group: undefined,
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
  if (state.identity.moved() || !state.group)
    state.group = device.createBindGroup({
      layout: kernel.group,
      entries: [
        ...objects.bindEntries(0),
        { binding: MESH_TRACE_BINDING.params, resource: { buffer: lists.params } },
        { binding: MESH_TRACE_BINDING.cells, resource: { buffer: lists.cells } },
        { binding: MESH_TRACE_BINDING.indices, resource: { buffer: lists.indices } },
      ],
    })
  return { pipeline: kernel.pipeline(), group: state.group }
}
