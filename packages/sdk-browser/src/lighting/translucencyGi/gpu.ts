import type { TranslucencyGiValues } from '../../../../sdk-core/src/contracts/translucencyGiOptions.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import type { PoolMarker } from '../bounce/pool/pool.ts'
import type { CacheRead } from './cache.ts'
import { wordViews } from '../../gpu/core/wordViews.ts'
import { TAU } from '../../../../math/src/constants.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { FILTER_GI_BINDING } from './filterWgsl.ts'
import { INTEGRATE_GI_BINDING } from './integrateWgsl.ts'
import {
  TRANSLUCENCY_GI_FRAME,
  TRANSLUCENCY_GI_GROUP,
  translucencyGiFootprintLevel,
  translucencyGiJitter,
  type TranslucencyGiGrid,
} from './layout.ts'
import type { TranslucencyGiKernels } from './kernels.ts'
import { markerOf } from './marker.ts'
import { giSampler, type GiResources } from './resources.ts'
import { traceGroupOf, type GiTraceInputs } from './traceGroup.ts'

/** What a view keeps of the volume between two images: its resources at the size of the grid, the turn the two volumes take, whether the
 *  volume of the image before is a history to read and what it was made at, and what the surfaces read of this image's. */
export interface TranslucencyGiState {
  resources?: GiResources
  /** The volume this image writes; the other is the history. */
  turn: 0 | 1
  /** Whether the last image left a volume to blend with, at the grid and the slices' law of `law`. */
  known: boolean
  /** The numbers the last image's history and marks were made at (`frame.ts`, `lawOf`). */
  readonly law: Float64Array
  /** The unjittered view-projection, set at its eye, and the eye of the last image traced (`GiImage`). */
  readonly previous: Float32Array
  readonly previousEye: Float64Array
  /** The images traced since the history began over, and the images a still view takes to make the volume whole. */
  frames: number
  horizon: number
  /** The camera cuts seen: the history is none past one. */
  revision?: number
  published: {
    /** The texture the surfaces read, the ambient light and the directional light stacked in its depth. */
    volume?: GPUTextureView
    /** The light before its history and its intensity, which the fog reads (`integrateWgsl.ts`), in the same grid. */
    fogView?: GPUTextureView
    readonly grid: Float32Array
    readonly z: Float32Array
  }
  groups?: { filter: GPUBindGroup[]; integrate: GPUBindGroup[]; filtered: boolean }
  readonly trace: ReturnType<typeof createWebgpuBindIdentity>
  traceGroup?: GPUBindGroup
  readonly bytes: number
  /** Which pool the last image made the volume mark its cells' probes in: the world's (a shared cache), the volume's own, or none (it reads no
   *  radiance cache). */
  marks: 'none' | 'shared' | 'own'
  /** The images since the volume was last wanted (`frame.ts`): the textures are given back past a few. */
  idle: number
  /** What the trace reads of the image, filled in place. */
  readonly inputs: GiTraceInputs
  /** The mark of the cells' probes the pool runs, made with the state (`translucencyGiMarkers` hands it over while the volume marks). */
  readonly markers: readonly PoolMarker[]
}

/** A state with nothing made, its mark (`markerOf`) in a list made once. */
export function newGiState(rt: WebgpuPagesRuntime): TranslucencyGiState {
  const markers: PoolMarker[] = []
  const state: TranslucencyGiState = {
    markers,
    turn: 0,
    known: false,
    law: new Float64Array(LAW_WORDS),
    previous: new Float32Array(16),
    previousEye: new Float64Array(3),
    frames: 0,
    horizon: 0,
    marks: 'none',
    idle: 0,
    inputs: {} as GiTraceInputs,
    published: { grid: new Float32Array(4), z: new Float32Array(4) },
    trace: createWebgpuBindIdentity(1),
    get bytes() {
      return this.resources?.bytes ?? 0
    },
  }
  markers.push(markerOf(rt, state))
  return state
}

/** What an image gives the volume beyond its settings: its size, the camera's near plane, the pre-exposure, the rank, whether the history
 *  holds, the camera's eye and its view-projection set at the eye (`viewProjectionRelative`), and the inverse of that, without the
 *  anti-aliasing jitter. */
export interface GiImage {
  width: number
  height: number
  near: number
  preExposure: number
  frame: number
  history: boolean
  eye: ArrayLike<number>
  viewProjection: ArrayLike<number>
  inverse: ArrayLike<number>
}

/** The numbers the history and the marks of an image depend on (`lawOf`, `frame.ts`), in `TranslucencyGiState.law`: the grid's cells
 *  (3) and the shift of its cell's side, the slices' law (3), the near plane and the cones a cell side — the history's —, then the
 *  marks' — the cascades the radiance cache is read coarser by (none where it is not read, nor in the volume's own cache) and whether the
 *  point of a cell turns. */
export const LAW_WORDS = 11
/** The words of the law the history holds at: the volume's textures and the places of its cells. */
export const LAW_HISTORY_WORDS = 9

const FRAME_IMAGE = new ArrayBuffer(TRANSLUCENCY_GI_FRAME.words * 4)
const FRAME_VIEWS = wordViews(FRAME_IMAGE)

/** Four floats at the word `at` of the frame. */
function put(f: Float32Array, at: number, x: number, y: number, z: number, w: number) {
  f[at] = x
  f[at + 1] = y
  f[at + 2] = z
  f[at + 3] = w
}

/** How an image reads the radiance cache: whether it does, the cascades it reads and marks coarser than the one that covers a cell (none in the
 *  volume's own cache), and the shape of the maps. */
export interface GiCacheRead {
  cached: boolean
  bias: number
  cache: CacheRead
}

type FrameViews = typeof FRAME_VIEWS
type FrameAt = typeof TRANSLUCENCY_GI_FRAME.at

/** The grid, the view, the slices' law, the jitters and the trace's and depth's settings of the frame's uniform. */
function writeGiFrameTrace(
  { u, f }: FrameViews,
  at: FrameAt,
  grid: TranslucencyGiGrid,
  v: TranslucencyGiValues,
  image: GiImage,
) {
  u[at.grid] = grid.x
  u[at.grid + 1] = grid.y
  u[at.grid + 2] = grid.z
  u[at.grid + 3] = grid.shift
  put(f, at.extent, image.width, image.height, 1 / image.width, 1 / image.height)
  put(f, at.zParams, grid.logZScale, grid.logZOffset, grid.zScale, image.near)
  translucencyGiJitter(v, image.frame, f, at.jitter)
  put(
    f,
    at.trace,
    v.translucencyGiTracingResolution,
    v.translucencyGiMaxRayIntensity,
    image.preExposure,
    1 / image.preExposure,
  )
  put(
    f,
    at.depth,
    v.translucencyGiGridCenterOffsetFromDepthBuffer,
    v.translucencyGiOffsetThresholdToAcceptDepthBufferOffset,
    translucencyGiFootprintLevel(grid.shift),
    v.translucencyGiTraceFromVolume ? 1 : 0,
  )
}

/** The history's, the filter's and the radiance cache's settings of the frame's uniform. */
function writeGiFrameFilter(
  f: Float32Array,
  at: FrameAt,
  v: TranslucencyGiValues,
  image: GiImage,
  read: GiCacheRead,
) {
  put(
    f,
    at.temporal,
    v.translucencyGiTemporalHistoryWeight,
    image.history ? 1 : 0,
    image.frame,
    read.bias,
  )
  const sigma = v.translucencyGiSpatialFilterStandardDeviation
  put(
    f,
    at.spatial,
    v.translucencyGiSpatialFilterSampleCount,
    1 / (2 * sigma * sigma),
    1 / (sigma * Math.sqrt(TAU)),
    read.cached ? 1 : 0,
  )
  put(
    f,
    at.cache,
    read.cache.radiusScale,
    read.cache.resolution,
    read.cache.mipmaps,
    read.cache.sky ? 1 : 0,
  )
}

/** The frame's uniform written for an image: the grid, the view, the slices' law, the jitters, the settings of the trace, the filter and the
 *  history. Nothing is allocated by a call. */
export function writeGiFrame(
  device: GPUDevice,
  state: TranslucencyGiState,
  grid: TranslucencyGiGrid,
  v: TranslucencyGiValues,
  image: GiImage,
  read: GiCacheRead,
) {
  const { f } = FRAME_VIEWS
  const at = TRANSLUCENCY_GI_FRAME.at
  writeGiFrameTrace(FRAME_VIEWS, at, grid, v, image)
  writeGiFrameFilter(f, at, v, image, read)
  f.set(state.previous, at.previous)
  // The eye's travel since the image before, subtracted in double precision.
  put(
    f,
    at.eyeMoved,
    image.eye[0] - state.previousEye[0],
    image.eye[1] - state.previousEye[1],
    image.eye[2] - state.previousEye[2],
    0,
  )
  f.set(image.inverse as ArrayLike<number>, at.inverse)
  device.queue.writeBuffer(state.resources!.frame, 0, FRAME_IMAGE)
}

/** The filter's three groups (the cones' two textures taking turns) and the integration's two (the volumes taking turns, reading the
 *  filter's last result), made once for the resources and the kernels. */
function fixedGroups(
  device: GPUDevice,
  r: GiResources,
  kernels: TranslucencyGiKernels,
  filtered: boolean,
) {
  const f = FILTER_GI_BINDING,
    n = INTEGRATE_GI_BINDING
  const filter = [0, 1, 2].map((pass) =>
    device.createBindGroup({
      layout: kernels.filter.layout,
      entries: [
        { binding: f.frame, resource: { buffer: r.frame } },
        { binding: f.input, resource: r.cones[pass % 2] },
        { binding: f.output, resource: r.cones[1 - (pass % 2)] },
      ],
    }),
  )
  const cones = r.cones[filtered ? 1 : 0]
  const integrate = [0, 1].map((turn) =>
    device.createBindGroup({
      layout: kernels.integrate.layout,
      entries: [
        { binding: n.frame, resource: { buffer: r.frame } },
        { binding: n.cones, resource: cones },
        { binding: n.history, resource: r.volumes[1 - turn] },
        { binding: n.sampler, resource: giSampler(device) },
        { binding: n.volume, resource: r.volumes[turn] },
        { binding: n.fog, resource: r.fogVolume },
      ],
    }),
  )
  return { filter, integrate, filtered }
}

/** The three axes of the filter, in order. */
const FILTER_AXES = ['filterX', 'filterY', 'filterZ'] as const

/** The passes of an image in `pass`: the trace of the cells' cones, the filter's axes where it is on, the integration into the volume of
 *  this image's turn; `reflection` is group 1 of the trace and the integration. */
export function encodeGiPasses(
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  state: TranslucencyGiState,
  kernels: TranslucencyGiKernels,
  grid: TranslucencyGiGrid,
  v: TranslucencyGiValues,
  trace: GiTraceInputs,
  reflection: GPUBindGroup,
) {
  const tracing = v.translucencyGiTracingResolution
  const filtered = v.translucencyGiSpatialFilter
  const cellsX = ceilDiv(grid.x, TRANSLUCENCY_GI_GROUP)
  const cellsY = ceilDiv(grid.y, TRANSLUCENCY_GI_GROUP)
  const coneX = ceilDiv(grid.x * tracing, TRANSLUCENCY_GI_GROUP)
  const coneY = ceilDiv(grid.y * tracing, TRANSLUCENCY_GI_GROUP)
  pass.setBindGroup(1, reflection)
  pass.setPipeline(kernels.trace.pipelines.traceCones)
  pass.setBindGroup(0, traceGroupOf(device, state, kernels, trace))
  pass.dispatchWorkgroups(coneX, coneY, grid.z)
  if (state.groups?.filtered !== filtered)
    state.groups = fixedGroups(device, state.resources!, kernels, filtered)
  const groups = state.groups!
  if (filtered) {
    for (let k = 0; k < FILTER_AXES.length; k++) {
      pass.setPipeline(kernels.filter.pipelines[FILTER_AXES[k]])
      pass.setBindGroup(0, groups.filter[k])
      pass.dispatchWorkgroups(coneX, coneY, grid.z)
    }
  }
  pass.setPipeline(kernels.integrate.pipelines.integrateCells)
  pass.setBindGroup(0, groups.integrate[state.turn])
  pass.dispatchWorkgroups(cellsX, cellsY, grid.z)
}
