/**
 * The page marking from the froxels of the depth (`froxelGrid.ts`), in place of the pixel pass: the
 * froxels' buffers made when a view first marks from them, their groups kept until a resource they
 * name moves. A view whose single-layer water drew its depth before the marking marks the water's
 * surface after the scene: the build over the water's depth, keeping the pixels the water drew
 * over, then the same marking over a list and a grid of their own, the suns' pages alone — a second
 * pass of the same kernels.
 */
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { clampLowWins } from '../../../../../../math/src/scalar/reals.ts'
import { storageBufferCap } from '../../../../session/memory/pools.ts'
import type { VsmBindingSpec } from '../resources.ts'
import type { VsmComputePipe } from '../passKit.ts'
import { FROXEL_SCENE_BINDING } from './froxelBuildWgsl.ts'
import {
  FROXEL_LIST_HEADER_WORDS,
  FROXEL_TILE_SIZE,
  froxelListBytes,
  VSM_FROXEL_GRID_BYTES,
  writeFroxelGrid,
} from './froxelGrid.ts'

/** The labels of the froxel kernels, their pipes' and groups' alike. */
export const FROXEL_ARGS_LABEL = 'vsm.froxelArgs',
  FROXEL_MARK_LABEL = 'vsm.markPagesFromFroxels'
/** The label of the build of the scene's froxels, or of the water's. */
export const froxelBuildLabel = (water: boolean) =>
  water ? 'vsm.buildWaterFroxels' : 'vsm.buildFroxels'

/** What the froxel marking reads of the engine's frame (a part of `VsmMarkingView`). */
interface FroxelMarkView {
  depth: GPUTextureView
  /** The depth with the single-layer water drawn into it, where the water's surface is marked. */
  water?: GPUTextureView
  view: GPUBuffer
  directLights: GPUBuffer
  /** The shadowed lights' grid the marking pruned (`../projection/lightGridWgsl.ts`), walked as the
   *  engine's light grid (`tileLights` in the shader). */
  lightGrid: GPUBuffer
  lightVsmIds: GPUBuffer
  sunMapIds: GPUBuffer
  viewRectMin: readonly [number, number]
  viewSize: readonly [number, number]
  viewToClip: ArrayLike<number>
  viewToShifted: ArrayLike<number>
}

/** The froxel pipes — the build of the scene's froxels and of the water's, the arguments' kernel and
 *  the marking —, made when first asked. */
export interface FroxelPipes {
  froxelBuild(water?: boolean): VsmComputePipe
  froxelArgs(): VsmComputePipe
  /** The marking over the froxels; `throttled`, the program of a frame the compute throttle is on. */
  froxelMark(throttled?: boolean): VsmComputePipe
}

/** Group 0 of `p` over the tables `specs` name and the parameters at `paramsBinding`
 *  (`createVsmMarking`'s). */
export type TablesGroup = (
  label: string,
  p: VsmComputePipe,
  specs: readonly VsmBindingSpec[],
  paramsBinding?: number,
) => GPUBindGroup

interface FroxelState {
  list: GPUBuffer
  capacity: number
  args: GPUBuffer
  grid: GPUBuffer
  build?: GPUBindGroup
  /** The depths the build's group was made over: the scene's alone, or the water's and the scene's. */
  buildKey: unknown[]
  argsGroup?: GPUBindGroup
  mark?: GPUBindGroup
  markKey: unknown[]
}

/** What the marking hands a froxel pass beside the view, rewritten by each frame: the camera's kind,
 *  the marking's tables group of the frame set (`froxelMark`, made once a frame set) and how to make
 *  it. */
export interface FroxelMarkContext {
  perspective: boolean
  /** Whether the compute throttle is on this frame: the marking program that reads each map's own bias. */
  throttled: boolean
  groups: { froxelMark?: GPUBindGroup }
  tablesGroup: TablesGroup
  specs: readonly VsmBindingSpec[]
}

export interface FroxelMarking {
  /** The marks from the froxels of the depth: the grid and the count written, the froxels built tile
   *  by tile, the marking's arguments sized on the GPU from their count, then the marking over
   *  them; then, where the view's water drew its depth (`v.water`), the same over the water's
   *  surface. */
  mark(pass: GPUComputePassEncoder, v: FroxelMarkView, ctx: FroxelMarkContext): void
  /** Gives back the buffers the passes hold: the marking from the froxels is off, or released. */
  destroy(): void
}

/** The froxels' buffers for `capacity` froxels: a froxel a pixel at most. */
function makeFroxelState(device: GPUDevice, capacity: number): FroxelState {
  const buffer = (label: string, size: number, usage: GPUBufferUsageFlags) =>
    device.createBuffer({ label: `vsm.froxel.${label}`, size, usage })
  return {
    capacity,
    list: buffer(
      'list',
      froxelListBytes(capacity),
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    ),
    args: buffer('args', 16, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT),
    grid: buffer('grid', VSM_FROXEL_GRID_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    buildKey: [],
    markKey: [],
  }
}

/** The build's group over the depth `depth` (and, for the water's, the scene's depth `scene`), made
 *  again when a depth moved. */
function buildGroup(
  device: GPUDevice,
  st: FroxelState,
  build: VsmComputePipe,
  depth: GPUTextureView,
  scene?: GPUTextureView,
) {
  const key = [depth, scene]
  if (st.build && !key.some((resource, k) => resource !== st.buildKey[k])) return st.build
  st.buildKey = key
  return (st.build = device.createBindGroup({
    label: froxelBuildLabel(!!scene),
    layout: build.groups[0],
    entries: [
      { binding: 0, resource: depth },
      { binding: 1, resource: { buffer: st.grid } },
      { binding: 2, resource: { buffer: st.list } },
      ...(scene ? [{ binding: FROXEL_SCENE_BINDING, resource: scene }] : []),
    ],
  }))
}

/** The arguments kernel's group, made once with the buffers. */
function argsGroup(device: GPUDevice, st: FroxelState, sizing: VsmComputePipe) {
  return (st.argsGroup ??= device.createBindGroup({
    label: FROXEL_ARGS_LABEL,
    layout: sizing.groups[0],
    entries: [
      { binding: 0, resource: { buffer: st.grid } },
      { binding: 1, resource: { buffer: st.list } },
      { binding: 2, resource: { buffer: st.args } },
    ],
  }))
}

/** The marking's group 1 over the buffers of `v` and the marking `params`, made again when one of
 *  them moved. */
function markGroup(
  device: GPUDevice,
  params: GPUBuffer,
  st: FroxelState,
  v: FroxelMarkView,
  mark: VsmComputePipe,
) {
  const key = [v.view, v.directLights, v.lightGrid, v.lightVsmIds, v.sunMapIds, params, st.list]
  if (st.mark && !key.some((resource, k) => resource !== st.markKey[k])) return st.mark
  st.markKey = key
  return (st.mark = device.createBindGroup({
    label: FROXEL_MARK_LABEL,
    layout: mark.groups[1],
    entries: [
      { binding: 0, resource: { buffer: st.grid } },
      { binding: 1, resource: { buffer: st.list } },
      { binding: 3, resource: { buffer: v.view } },
      { binding: 4, resource: { buffer: v.directLights } },
      { binding: 5, resource: { buffer: v.lightGrid } },
      { binding: 6, resource: { buffer: v.lightVsmIds } },
      { binding: 7, resource: { buffer: v.sunMapIds } },
      { binding: 8, resource: { buffer: params } },
    ],
  }))
}

/** The passes of the marking, the scene's and the water's, each with froxel buffers of its own. */
const SCENE = 0,
  WATER = 1

/** The froxels' marking over `pipes`, the marking `params` bound to its groups. */
export function createFroxelMarking(
  device: GPUDevice,
  pipes: FroxelPipes,
  params: GPUBuffer,
): FroxelMarking {
  const passes: (FroxelState | undefined)[] = [undefined, undefined]
  const gridData = new ArrayBuffer(VSM_FROXEL_GRID_BYTES)
  const countZero = new Uint32Array(4)
  /** The froxels a view holds at most: a froxel a pixel (the reference's room, held to the device's
   *  binding). */
  const capacityOf = (v: FroxelMarkView) =>
    clampLowWins(
      v.viewSize[0] * v.viewSize[1],
      1,
      Math.floor((storageBufferCap(device.limits) - 4 * FROXEL_LIST_HEADER_WORDS) / 8),
    )
  function release(pass: number) {
    const held = passes[pass]
    if (!held) return
    for (const buffer of [held.list, held.args, held.grid]) buffer.destroy()
    passes[pass] = undefined
  }
  /** One pass over the froxels of the view `v`: the scene's, or the water's (`water`), whose froxels
   *  are the pixels the water drew over (`v.water` over the scene's depth `v.depth`) and whose pages
   *  are the suns' alone. The grid and the count written, the froxels built tile by tile, the marking's
   *  arguments sized on the GPU from their count, then the marking over them. */
  function markPass(
    pass: GPUComputePassEncoder,
    v: FroxelMarkView,
    ctx: FroxelMarkContext,
    water: boolean,
  ) {
    const which = water ? WATER : SCENE
    const st = (passes[which] ??= makeFroxelState(device, capacityOf(v)))
    writeFroxelGrid(gridData, {
      viewToClip: v.viewToClip,
      perspective: ctx.perspective,
      viewRectMin: v.viewRectMin,
      viewSize: v.viewSize,
      viewToShifted: v.viewToShifted,
      capacity: st.capacity,
      markLocalLights: !water,
    })
    device.queue.writeBuffer(st.grid, 0, gridData)
    device.queue.writeBuffer(st.list, 0, countZero)
    const build = pipes.froxelBuild(water),
      sizing = pipes.froxelArgs(),
      mark = pipes.froxelMark(ctx.throttled)
    const buildBound = water
      ? buildGroup(device, st, build, v.water!, v.depth)
      : buildGroup(device, st, build, v.depth)
    const argsBound = argsGroup(device, st, sizing)
    const markBound = markGroup(device, params, st, v, mark)
    // Each asked, so that the three compile together, not one after the other.
    const buildPipeline = build.pipeline,
      sizingPipeline = sizing.pipeline,
      markPipeline = mark.pipeline
    if (!buildPipeline || !sizingPipeline || !markPipeline) return
    pass.setPipeline(buildPipeline)
    pass.setBindGroup(0, buildBound)
    pass.dispatchWorkgroups(
      ceilDiv(v.viewSize[0], FROXEL_TILE_SIZE),
      ceilDiv(v.viewSize[1], FROXEL_TILE_SIZE),
    )
    pass.setPipeline(sizingPipeline)
    pass.setBindGroup(0, argsBound)
    pass.dispatchWorkgroups(1)
    ctx.groups.froxelMark ??= ctx.tablesGroup(FROXEL_MARK_LABEL, mark, ctx.specs)
    pass.setPipeline(markPipeline)
    pass.setBindGroup(0, ctx.groups.froxelMark)
    pass.setBindGroup(1, markBound)
    pass.dispatchWorkgroupsIndirect(st.args, 0)
  }
  return {
    mark(pass, v, ctx) {
      // A view resized holds the buffers of the size before no longer, the water's included.
      const capacity = capacityOf(v)
      if (passes[SCENE]?.capacity !== capacity) release(SCENE)
      if (passes[WATER]?.capacity !== capacity) release(WATER)
      markPass(pass, v, ctx, false)
      // The water's surface after the scene's: the water takes no shadow from a local light. Its
      // buffers are held while the marking is on, whether or not this image drew water.
      if (v.water) markPass(pass, v, ctx, true)
    },
    destroy() {
      release(SCENE)
      release(WATER)
    },
  }
}
