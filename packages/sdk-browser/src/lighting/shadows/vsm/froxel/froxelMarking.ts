/**
 * The page marking from the froxels of the depth (`froxelGrid.ts`), in place of the pixel pass: the
 * froxels' buffers made when a view first marks from them, their groups kept until a resource they
 * name moves.
 */
import { ceilDiv } from '../../../../../../math/src/scalar/integers.ts'
import { clampLowWins } from '../../../../../../math/src/scalar/reals.ts'
import { storageBufferCap } from '../../../../session/memory/pools.ts'
import type { VsmBindingSpec } from '../resources.ts'
import type { VsmComputePipe } from '../passKit.ts'
import {
  FROXEL_LIST_HEADER_WORDS,
  FROXEL_TILE_SIZE,
  froxelListBytes,
  VSM_FROXEL_GRID_BYTES,
  writeFroxelGrid,
} from './froxelGrid.ts'

/** The labels of the froxel kernels, their pipes' and groups' alike. */
export const FROXEL_BUILD_LABEL = 'vsm.buildFroxels',
  FROXEL_ARGS_LABEL = 'vsm.froxelArgs',
  FROXEL_MARK_LABEL = 'vsm.markPagesFromFroxels'

/** What the froxel marking reads of the engine's frame (a part of `VsmMarkingView`). */
interface FroxelMarkView {
  depth: GPUTextureView
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

/** The three froxel pipes, made when first asked. */
export interface FroxelPipes {
  froxelBuild(): VsmComputePipe
  froxelArgs(): VsmComputePipe
  froxelMark(): VsmComputePipe
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
  buildDepth?: GPUTextureView
  argsGroup?: GPUBindGroup
  mark?: GPUBindGroup
  markKey: unknown[]
}

export interface FroxelMarking {
  /** The marks from the froxels of the depth: the grid and the count written, the froxels built tile
   *  by tile, the marking's arguments sized on the GPU from their count, then the marking over
   *  them. `groups.froxelMark` is the marking's tables group, made once a frame set. */
  mark(
    pass: GPUComputePassEncoder,
    v: FroxelMarkView,
    perspective: boolean,
    groups: { froxelMark?: GPUBindGroup },
    tablesGroup: TablesGroup,
    specs: readonly VsmBindingSpec[],
  ): void
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
    markKey: [],
  }
}

/** The build's group over the depth `depth`, made again when the depth moved. */
function buildGroup(
  device: GPUDevice,
  st: FroxelState,
  depth: GPUTextureView,
  build: VsmComputePipe,
) {
  if (st.buildDepth === depth && st.build) return st.build
  st.buildDepth = depth
  return (st.build = device.createBindGroup({
    label: FROXEL_BUILD_LABEL,
    layout: build.groups[0],
    entries: [
      { binding: 0, resource: depth },
      { binding: 1, resource: { buffer: st.grid } },
      { binding: 2, resource: { buffer: st.list } },
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

/** The froxels' marking over `pipes`, the marking `params` bound to its groups. */
export function createFroxelMarking(
  device: GPUDevice,
  pipes: FroxelPipes,
  params: GPUBuffer,
): FroxelMarking {
  let froxels: FroxelState | undefined
  const gridData = new ArrayBuffer(VSM_FROXEL_GRID_BYTES)
  const countZero = new Uint32Array(4)
  /** The froxels' buffers for a view of `area` pixels: a froxel a pixel at most (the reference's room,
   *  held to the device's binding), made again when the view's area moved. */
  function froxelState(area: number) {
    const capacity = clampLowWins(
      area,
      1,
      Math.floor((storageBufferCap(device.limits) - 4 * FROXEL_LIST_HEADER_WORDS) / 8),
    )
    if (froxels?.capacity === capacity) return froxels
    destroy()
    return (froxels = makeFroxelState(device, capacity))
  }
  function destroy() {
    if (!froxels) return
    for (const buffer of [froxels.list, froxels.args, froxels.grid]) buffer.destroy()
    froxels = undefined
  }
  return {
    mark(pass, v, perspective, groups, tablesGroup, specs) {
      const st = froxelState(v.viewSize[0] * v.viewSize[1])
      writeFroxelGrid(gridData, {
        viewToClip: v.viewToClip,
        perspective,
        viewRectMin: v.viewRectMin,
        viewSize: v.viewSize,
        viewToShifted: v.viewToShifted,
        capacity: st.capacity,
      })
      device.queue.writeBuffer(st.grid, 0, gridData)
      device.queue.writeBuffer(st.list, 0, countZero)
      const build = pipes.froxelBuild(),
        sizing = pipes.froxelArgs(),
        mark = pipes.froxelMark()
      const buildBound = buildGroup(device, st, v.depth, build)
      const argsBound = argsGroup(device, st, sizing)
      const markBound = markGroup(device, params, st, v, mark)
      if (!build.pipeline || !sizing.pipeline || !mark.pipeline) return
      pass.setPipeline(build.pipeline)
      pass.setBindGroup(0, buildBound)
      pass.dispatchWorkgroups(
        ceilDiv(v.viewSize[0], FROXEL_TILE_SIZE),
        ceilDiv(v.viewSize[1], FROXEL_TILE_SIZE),
      )
      pass.setPipeline(sizing.pipeline)
      pass.setBindGroup(0, argsBound)
      pass.dispatchWorkgroups(1)
      groups.froxelMark ??= tablesGroup(FROXEL_MARK_LABEL, mark, specs)
      pass.setPipeline(mark.pipeline)
      pass.setBindGroup(0, groups.froxelMark)
      pass.setBindGroup(1, markBound)
      pass.dispatchWorkgroupsIndirect(st.args, 0)
    },
    destroy,
  }
}
