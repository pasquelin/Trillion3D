/**
 * THE COMPOSITION'S PASSES IN THE FRAME'S COMMAND BUFFER (`gpuCompose.ts`): the worlds pass, then
 * the roots pass, before the cut kernel reads what they write.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { dispatchRows } from '../gpu/dispatch/grid.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { COMPOSE_ROOTS_PASS } from '../stage/passLabels.ts'
import { MOTION_SKIP } from './composedMotion.ts'
import { composeGroup, heldGroup } from './composeGroups.ts'
import { composeKernels, frameParents } from './gpuComposeFrame.ts'
import { NO_RANGES, writeRangeParams } from './gpuComposeGpu.ts'
import { rootEntries, worldEntries } from './gpuComposeEntries.ts'

/**
 * The linked roots' composed worlds, once a root, into the roots' double worlds and their world
 * boxes (`COMPOSE_WORLDS_WGSL`), on the frames what they compose moved — a parent, a link — or a
 * table they write was made anew: what the roots pass and the rows pass read next. Encoded into
 * `pass`; whether it was.
 */
function encodeComposedWorlds(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: () => GPUComputePassEncoder,
) {
  const state = rt.compose!,
    gpu = state.gpu!,
    listed = state.rankList.set.count
  if (!rt.rootWorlds?.worlds || !listed) return
  const pipeline = composeKernels(device).worlds.get(),
    held = gpu.worldsGroup
  held.identity.entries[0] ??= worldEntries(rt, gpu)
  const bound = composeGroup(device, held, pipeline)
  if (state.composedAt === state.ranAt.worlds && !bound) return
  state.ranAt.worlds = state.composedAt
  // A table made anew holds no composed world: the rows pass derives every row of them again.
  state.ranAt.rows = bound ? -1 : state.ranAt.rows
  const params = state.worldParams
  params[0] = state.roots
  params[1] = listed
  device.queue.writeBuffer(gpu.worldParams, 0, params)
  const encoder = pass()
  encoder.setPipeline(pipeline)
  encoder.setBindGroup(0, held.group!)
  dispatchRows(encoder, ceilDiv(listed, 64))
  rt.run.gpuComputeDispatches++
}

/** The linked roots' worlds (`encodeComposedWorlds`), then their cut worlds and motion, before the
 *  cut kernel reads them: a thread each of the composed roots, and nothing on a frame where nothing
 *  they read or write moved — no parent, no link, no host write of the cut's words, and their
 *  motion settled (`decideComposedMotion`). One compute pass, opened by the first that runs. */
export function encodeComposedRoots(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
) {
  const state = rt.compose,
    gpu = frameParents(rt, device)
  if (!state || !gpu?.parents || !gpu.rankList) return
  let open: GPUComputePassEncoder | undefined
  const pass = () => (open ??= encoder.beginComputePass({ label: COMPOSE_ROOTS_PASS }))
  encodeComposedWorlds(rt, device, pass)
  encodeRootsPass(rt, device, pass)
  open?.end()
}

/** The roots pass (`COMPOSE_ROOTS_WGSL`) over every range of the cut's worlds, into `pass`. */
function encodeRootsPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  pass: () => GPUComputePassEncoder,
) {
  const state = rt.compose!,
    selection = rt.run.gpuSelection,
    gpu = state.gpu!
  // The worlds it reads are the roots' double worlds (`rootWorlds.ts`), sent with the frame's rows.
  if (!selection || !rt.rootWorlds?.worlds) return
  const listed = state.rankList.set.count
  if (!listed) return
  // The worlds this pass writes are the ones the cut kernel reads next: no CPU world changed, so
  // no `updateWorlds` saw the turn, and the cut would keep the levels and frustum of the last full
  // write. A frame whose parents moved advances the selection's world revision, as a CPU pose
  // write does, and the dispatch that follows in this command buffer cuts again under them.
  if (state.moving) selection.worldsMovedOnGpu(state.rankList.set.list.subarray(0, listed))
  const motionBuffer = rt.gpu.temporal?.frame.active ? rt.gpu.temporal.motion.buffer : undefined
  const ranges = selection.worldRanges,
    pipeline = composeKernels(device).roots.get()
  writeRangeParams(device, gpu.rootParams, ranges, state.roots, listed)
  gpu.frame.ranges = ranges
  gpu.frame.motion = motionBuffer
  let bound = false
  for (let r = 0; r < ranges.length; r++) {
    const held = (gpu.rootGroups[r] ??= heldGroup())
    held.identity.entries[0] ??= rootEntries(rt, device, gpu, r)
    if (composeGroup(device, held, pipeline)) bound = true
  }
  // The groups are made: the cut's ranges are not held past them, so a cut swapped out goes.
  gpu.frame.ranges = NO_RANGES
  // Every word this pass writes is the one it wrote last, unless something it reads moved, a host
  // write put its own words there (`frameWrites`), or the motion is not settled: a still view of a
  // composed scene costs no pass.
  const motionSettled = !motionBuffer || (state.previousCurrent && state.motionIdentity)
  if (
    state.composedAt === state.ranAt.roots &&
    !bound &&
    motionSettled &&
    motionBuffer === state.ranAt.motion &&
    selection.frameWrites === state.ranAt.frameWrites
  )
    return
  // The previous worlds are current when they were before and no world moved since; a motion
  // buffer bound anew holds rows the pass has not written.
  state.ranFrame = rt.run.frame
  state.ranCurrent = state.previousCurrent && state.composedAt === state.ranAt.roots
  state.previousCurrent = state.ranCurrent
  state.ranAt.roots = state.composedAt
  if (motionBuffer !== state.ranAt.motion) state.motionIdentity = false
  state.ranAt.motion = motionBuffer
  state.ranAt.frameWrites = selection.frameWrites
  // No motion until the temporal pass decides one, later in this frame's encoding.
  state.motionBound = motionBuffer
  state.motionMode[0] = MOTION_SKIP
  device.queue.writeBuffer(gpu.motionMode, 0, state.motionMode)
  const encoder = pass()
  encoder.setPipeline(pipeline)
  for (let r = 0; r < ranges.length; r++) {
    encoder.setBindGroup(0, gpu.rootGroups[r].group!)
    dispatchRows(encoder, ceilDiv(listed, 64))
  }
  rt.run.gpuComputeDispatches += ranges.length
}
