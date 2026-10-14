/**
 * THE ROWS PASS ON THE GPU (`rowWordsWgsl.ts`): a thread a row of the roots a parent composes once
 * their worlds moved (`composedRows.ts`), then a thread a row the CPU named this frame
 * (`rowWords.ts`) — or every caster row, when a buffer it writes or reads was made anew. It runs in
 * the frame's command buffer after the compose worlds pass and before any reader of the words. The
 * composed rows go first: a row both lists name has its shadow change appended from the pose it
 * left, before the second derivation finds it where it already stands (`rowCastWgsl.ts`). A row the
 * CPU named for a shadow change where it stands (`ROW_STALES`) appends the box of the sphere it
 * holds before its thread derives it; while every row is derived, those rows' list goes first.
 */
import { autoKernel } from '../gpu/core/computeStages.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { COMPOSE_ROWS_PASS } from '../stage/passLabels.ts'
import {
  DERIVE_ROWS_ENTRY,
  DERIVE_ROWS_WGSL,
  PART_CASTS,
  PART_CORNERS,
  PART_LODS,
  PART_SPHERES,
} from './rowWordsWgsl.ts'
import { composeGroup } from '../webgpu/core/bindIdentity.ts'
import { castsBound, createRowWordsGpu, partsMoved, rowEntries } from './rowWordsGpu.ts'
import { dispatchGroup, sendWords } from './rootListPass.ts'
import { followComposedRows, sendList } from './composedRows.ts'
import { partsMadeAnew, targetsTaken } from './rowTargets.ts'
import { writeMovedRoots } from './rootPasses.ts'
import { reserveCasts } from '../webgpu/shadow/castChanges.ts'
import { writePassParams } from '../gpu/core/passParams.ts'

/** The rows kernel, once a device, compiled off the thread (`askRowWords`). */
const rowsKernel = autoKernel(COMPOSE_ROWS_PASS, DERIVE_ROWS_WGSL, DERIVE_ROWS_ENTRY)

/** Asks the rows kernel at a frame's entry once the table holds a row
 *  (`../webgpu/frame/framePipelines.ts`). */
export function askRowWords(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.layout.rows.casterSlots) rowsKernel(device).ask()
}

/** The rows of the composed roots the pass derives this frame: all of them on the first frame
 *  after the compose worlds pass wrote worlds it had not derived them at, none otherwise. */
function composedRows(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const state = rt.compose,
    gpu = state?.gpu
  if (!state?.parentIds.size || !gpu?.parents) return 0
  followComposedRows(rt, state)
  gpu.rowList = sendList(device, gpu.rowList, 'Trillion3D composed rows', state.rowList)
  if (state.ranAt.worlds !== state.composedAt || state.ranAt.rows === state.composedAt) return 0
  state.ranAt.rows = state.composedAt
  return state.rowList.set.count
}

/** Dispatch `g` of the pass over `listed` rows, `all` of the table or those its list names; every
 *  row's shadow change asked when `emitAll`, else a listed row's when its list asks it. */
function dispatch(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  g: number,
  listed: number,
  all: boolean,
  emitAll: boolean,
) {
  const gpu = rt.rowWords!.gpu!
  const parts =
    (gpu.frame[0] ? PART_SPHERES : 0) |
    (gpu.frame[1] ? PART_CORNERS : 0) |
    (gpu.frame[2] ? PART_LODS : 0) |
    (castsBound(rt) ? PART_CASTS : 0)
  const roots = rt.layout.selectionRoots.length
  writePassParams(device, gpu.params[g], roots, parts, listed, all ? 1 : 0, emitAll ? 1 : 0)
  const held = gpu.groups[g]
  held.identity.entries[0] ??= rowEntries(rt, gpu, g)
  composeGroup(device, held, pipeline)
  dispatchGroup(rt, pass, held, listed)
}

/**
 * The rows pass, before anything reads a row's words this frame: the composed rows when their
 * worlds moved, then the named rows — every caster row when a buffer it binds was made anew, the
 * rows named for a shadow change where they stand listed first then (`ROW_STALES`). A sphere buffer
 * made anew staled every page already (`spheresMadeAnew`): the rows named are forgotten. Nothing on
 * a frame where no row was written, no root moved and no row was named. The shadow changes it may
 * append have their room first (`reserveCasts`): two a row whose change is asked, the pose left and
 * the one entered, one a row staled; a pass over every row appends into the room the list holds,
 * past which it stales every page.
 */
export function encodeRowWords(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const state = rt.rowWords,
    worlds = rt.rootWorlds,
    { rows } = rt.layout
  if (!state?.inputs.buffer || !worlds?.worlds || !rt.vis.pageTable || !rows.casterSlots) return
  // The root boxes the detail reads, of a world moved since the cut wrote them, first.
  writeMovedRoots(rt)
  const gpu = (state.gpu ??= createRowWordsGpu(device))
  const spheresAnew = gpu.named[4] !== rt.lights.spheres?.buffer
  gpu.frame[0] = rt.lights.spheres?.buffer
  gpu.frame[1] = rt.vis.gpuPartition?.corners
  gpu.frame[2] = rt.lights.rowLods?.buffer
  if (partsMoved(rt, gpu)) partsMadeAnew(state, spheresAnew)
  const composed = composedRows(rt, device)
  const all = state.all,
    listed = all ? rows.casterSlots : state.count,
    staledFirst = all && state.stales > 0
  if (!listed && !composed) return
  if (state.count && (!all || staledFirst))
    gpu.list = sendWords(device, gpu.list, state.targets, state.count, 'Trillion3D rows pass list')
  const casts = castsBound(rt) ? rt.lights.casts : undefined
  if (casts) {
    const asked = 2 * ((all ? 0 : composed) + state.emits) + state.stales
    reserveCasts(casts, device, asked, rows.casterSlots)
  }
  const pipeline = rowsKernel(device).get()
  const pass = encoder.beginComputePass({ label: COMPOSE_ROWS_PASS })
  pass.setPipeline(pipeline)
  if (composed && !all) dispatch(rt, device, pass, pipeline, 1, composed, false, true)
  // Every row derived: the staled rows' list first, every change asked, as the whole pass asks.
  if (staledFirst) dispatch(rt, device, pass, pipeline, 0, state.count, false, true)
  if (listed) dispatch(rt, device, pass, pipeline, staledFirst ? 1 : 0, listed, all, all)
  pass.end()
  targetsTaken(state, encoder)
}
