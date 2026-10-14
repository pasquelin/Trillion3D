/**
 * THE COMPOSITION'S PASSES (`gpuCompose.ts`): the worlds pass, then the roots pass, in the roots'
 * one compute pass, whose command buffer goes before every cut (`rootPasses.ts`): what they write
 * is on the GPU before the root boxes, the tree's leaves, the cut and the rows read it.
 */
import { ceilDiv } from '../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../gpu/dispatch/grid.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { MOTION_SKIP } from './composedMotion.ts'
import { composeGroup, type HeldGroup } from '../webgpu/core/bindIdentity.ts'
import { composeKernels, frameParents } from './gpuComposeFrame.ts'
import { writePassParams } from '../gpu/core/passParams.ts'
import type { ComposeGpu } from './gpuComposeGpu.ts'
import type { OpenPass } from '../gpu/core/lazyComputePass.ts'
import { rootEntries, worldEntries } from './gpuComposeEntries.ts'

/** `pipeline` over `held`'s group, a thread each of the `listed` roots, into the roots' pass. */
function dispatchListed(
  rt: WebgpuPagesRuntime,
  open: OpenPass,
  pipeline: GPUComputePipeline,
  held: HeldGroup,
  listed: number,
) {
  const pass = open.pass
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, held.group!)
  dispatchRows(pass, ceilDiv(listed, WORKGROUP_THREADS))
  rt.run.gpuComputeDispatches++
}

/**
 * The linked roots' composed worlds, once a root, into the roots' double worlds and their world
 * boxes (`COMPOSE_WORLDS_WGSL`), on the frames what they compose moved — a parent, a link — or a
 * table they write was made anew: what the roots pass and the rows pass read next. Whether it was
 * encoded.
 */
function encodeComposedWorlds(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  open: OpenPass,
  gpu: ComposeGpu,
  listed: number,
) {
  const state = rt.compose!,
    pipeline = composeKernels.worlds(device).get(),
    held = gpu.worldsGroup
  writePassParams(device, gpu.worldParams, state.roots, listed)
  held.identity.entries[0] ??= worldEntries(rt, gpu)
  const bound = composeGroup(device, held, pipeline)
  if (state.composedAt === state.ranAt.worlds && !bound) return false
  state.ranAt.worlds = state.composedAt
  // A table made anew holds no composed world: the rows pass derives every row of them again.
  state.ranAt.rows = bound ? -1 : state.ranAt.rows
  dispatchListed(rt, open, pipeline, held, listed)
  return true
}

/** The linked roots' worlds (`encodeComposedWorlds`), then their cut worlds and motion, before the
 *  cut kernel reads them: a thread each of the composed roots, and nothing on a frame where nothing
 *  they read or write moved — no parent, no link, no host write of the cut's words, and their
 *  motion settled (`decideComposedMotion`). Into the roots' one compute pass `open`, opened by the
 *  first that runs (`../gpu/core/lazyComputePass.ts`). Whether the worlds were composed anew: the
 *  root boxes pass derives the composed roots' boxes from them. */
export function encodeComposedRoots(rt: WebgpuPagesRuntime, device: GPUDevice, open: OpenPass) {
  const state = rt.compose,
    gpu = frameParents(rt, device),
    listed = state?.rankList.set.count ?? 0
  // The worlds both read are the roots' double worlds (`rootWorlds.ts`), sent with the frame's rows.
  if (!state || !gpu?.parents || !gpu.rankList || !rt.rootWorlds?.worlds || !listed) return false
  const composed = encodeComposedWorlds(rt, device, open, gpu, listed)
  encodeRootsPass(rt, device, open, gpu, listed)
  return composed
}

/** The roots pass (`COMPOSE_ROOTS_WGSL`) into the cut's worlds. */
function encodeRootsPass(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  open: OpenPass,
  gpu: ComposeGpu,
  listed: number,
) {
  const state = rt.compose!,
    selection = rt.run.gpuSelection
  if (!selection) return
  // The worlds this pass writes are the ones the cut kernel reads next: no CPU world changed, so
  // no `updateWorlds` saw the turn, and the cut would keep the levels and frustum of the last full
  // write. A frame whose parents moved advances the selection's world revision, as a CPU pose
  // write does, and the dispatch that follows in this command buffer cuts again under them.
  if (state.moving) selection.worldsMovedOnGpu(state.rankList.set.list.subarray(0, listed))
  const motionBuffer = rt.gpu.temporal?.frame.active ? rt.gpu.temporal.motion.buffer : undefined
  const pipeline = composeKernels.roots(device).get(),
    held = gpu.rootGroup
  writePassParams(device, gpu.rootParams, state.roots, listed)
  gpu.frame.worlds = selection.worlds
  gpu.frame.motion = motionBuffer
  held.identity.entries[0] ??= rootEntries(rt, gpu)
  const bound = composeGroup(device, held, pipeline)
  // The group is made: the cut's worlds are not held past it, so a cut swapped out goes.
  gpu.frame.worlds = undefined
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
  dispatchListed(rt, open, pipeline, held, listed)
}
