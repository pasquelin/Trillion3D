/**
 * THE ROWS PASS ON THE GPU (`rowWordsWgsl.ts`): a thread a row of the roots a parent composes once
 * their worlds moved (`../compose/composedRows.ts`), then a thread a row the CPU named this frame
 * (`rowWords.ts`) — or every caster row, when a buffer it writes or reads was made anew. It runs in
 * the frame's command buffer after the compose worlds pass and before any reader of the words. The
 * composed rows go first: a row both lists name has its shadow change appended from the pose it
 * left, before the second derivation finds it where it already stands (`rowCastWgsl.ts`). A row the
 * CPU named for a shadow change where it stands (`ROW_STALES`) appends the box of the sphere it
 * holds before its thread derives it; while every row is derived, those rows' list goes first.
 */
import { autoKernel } from '../../gpu/core/computeStages.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { COMPOSE_ROWS_PASS } from '../../diagnostic/stage/passLabels.ts'
import {
  DERIVE_ROWS_ENTRY,
  DERIVE_ROWS_WGSL,
  PART_CASTS,
  PART_LODS,
  PART_SPHERES,
} from './rowWordsWgsl.ts'
import { composeGroup } from '../../gpu/bind/bindIdentity.ts'
import { castsBound, createRowWordsGpu, partsMoved, rowEntries } from './rowWordsGpu.ts'
import { dispatchGroup, sendWords } from '../roots/rootListPass.ts'
import { rowsOfRoots } from '../compose/composedRows.ts'
import { takeComposed } from '../compose/gpuComposeState.ts'
import { partsMadeAnew, targetsTaken } from './rowTargets.ts'
import { writeMovedRoots } from '../roots/rootPasses.ts'
import { reserveCasts } from '../../lighting/shadows/casters/castChanges.ts'
import { writePassParams } from '../../gpu/core/passParams.ts'

/** The rows kernel, once a device, compiled off the thread (`askRowWords`). */
const rowsKernel = autoKernel(COMPOSE_ROWS_PASS, DERIVE_ROWS_WGSL, DERIVE_ROWS_ENTRY)

/** Asks the rows kernel at a frame's entry once the table holds a row
 *  (`../../frame/loop/framePipelines.ts`). */
export function askRowWords(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.layout.rows.casterSlots) rowsKernel(device).ask()
}

/** The rows of the composed roots the pass derives this frame, on the first frame after the
 *  compose worlds pass wrote worlds it had not derived them at: the rows of the roots it composed
 *  since (`ComposeState.owed`), none otherwise — none either when every row is derived (`all`),
 *  which holds them. */
function composedRows(rt: WebgpuPagesRuntime, device: GPUDevice, all: boolean) {
  const state = rt.compose,
    gpu = state?.gpu
  if (!state?.parentIds.size || !gpu?.parents) return NO_ROWS
  if (state.ranAt.worlds !== state.composedAt || state.ranAt.rows === state.composedAt)
    return NO_ROWS
  state.ranAt.rows = state.composedAt
  const ranks = takeComposed(state, state.owed.rows)
  if (all) return NO_ROWS
  const rows = rowsOfRoots(rt, ranks)
  if (rows.length)
    gpu.rowList = sendWords(device, gpu.rowList, rows, rows.length, 'Trillion3D composed rows')
  return rows
}
const NO_ROWS = new Uint32Array(0)

/** Dispatch `g` of the pass over `listed` rows, `all` of the table or those its list names, each
 *  appending its shadow change (`castRow`). */
function dispatch(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: GPUComputePassEncoder,
  pipeline: GPUComputePipeline,
  g: number,
  listed: number,
  all: boolean,
) {
  const gpu = rt.rowWords!.gpu!
  const parts =
    (gpu.frame[0] ? PART_SPHERES : 0) |
    (gpu.frame[1] ? PART_LODS : 0) |
    (castsBound(rt) ? PART_CASTS : 0)
  writePassParams(device, gpu.params[g], rt.rootWorlds!.held, parts, listed, all ? 1 : 0)
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
 * append have their room first (`reserveCasts`): two a row derived — the pose left and the one
 * entered, at most —, one a row staled; a pass over every row appends into the room the list holds,
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
  gpu.frame[1] = rt.lights.rowLods?.buffer
  if (partsMoved(rt, gpu)) partsMadeAnew(state, spheresAnew)
  const all = state.all,
    composed = composedRows(rt, device, all).length,
    listed = all ? rows.casterSlots : state.count,
    staledFirst = all && state.stales > 0
  if (!listed && !composed) return
  if (state.count && (!all || staledFirst))
    gpu.list = sendWords(device, gpu.list, state.targets, state.count, 'Trillion3D rows pass list')
  const casts = castsBound(rt) ? rt.lights.casts : undefined
  if (casts)
    reserveCasts(casts, device, 2 * (composed + state.count) + state.stales, rows.casterSlots)
  const pipeline = rowsKernel(device).get()
  const pass = encoder.beginComputePass({ label: COMPOSE_ROWS_PASS })
  pass.setPipeline(pipeline)
  if (composed) dispatch(rt, device, pass, pipeline, 1, composed, false)
  // Every row derived: the staled rows' list first.
  if (staledFirst) dispatch(rt, device, pass, pipeline, 0, state.count, false)
  if (listed) dispatch(rt, device, pass, pipeline, staledFirst ? 1 : 0, listed, all)
  pass.end()
  targetsTaken(state, encoder)
}
