/**
 * THE COMPOSITION'S PASSES (`gpuCompose.ts`): the worlds pass, then the roots pass, in the roots'
 * one compute pass, whose command buffer goes before every cut (`../roots/rootPasses.ts`): what they write
 * is on the GPU before the root boxes, the tree's leaves, the cut and the rows read it.
 */
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { composeGroup, type HeldGroup } from '../../gpu/bind/bindIdentity.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { everyComposed, oweComposed, type ComposeState } from './gpuComposeState.ts'
import { composeKernels, frameParents } from './gpuComposeFrame.ts'
import { writePassParams } from '../../gpu/core/passParams.ts'
import { FRAME_LIST, type ComposeGpu } from './gpuComposeGpu.ts'
import type { OpenPass } from '../../gpu/core/lazyComputePass.ts'
import { rootEntries, worldEntries } from './gpuComposeEntries.ts'
import { dispatchGroup, sendWords } from '../roots/rootListPass.ts'
import { isEmpty, takeMoved } from '../roots/rootMoves.ts'

/** `pipeline` over `held`'s group, a thread each of the `listed` roots, into the roots' pass. */
function dispatchListed(
  rt: WebgpuPagesRuntime,
  open: OpenPass,
  pipeline: GPUComputePipeline,
  held: HeldGroup,
  listed: number,
) {
  open.pass.setPipeline(pipeline)
  dispatchGroup(rt, open.pass, held, listed)
}

/** The frame's composed roots, `ranks`, held (`frameRanks`) and sent into the list the worlds,
 *  roots and root boxes passes read. */
function sendFrame(device: GPUDevice, gpu: ComposeGpu, state: ComposeState, ranks: Int32Array) {
  state.frameRanks = resized(state.frameRanks, ranks.length)
  state.frameRanks.set(ranks)
  state.frameCount = ranks.length
  gpu.frameList = sendWords(device, gpu.frameList, state.frameRanks, ranks.length, FRAME_LIST)
}

/**
 * The linked roots' composed worlds, then their cut worlds, before the cut kernel reads them, and
 * the motion buffer the frame's motion pass writes (`composedMotionPass.ts`): a thread each of the
 * roots the frame composes again (`ComposeState.composed`), taken into the frame's list and owed to
 * the passes that derive from them later (`oweComposed`) — every composed root listed once a group
 * was bound anew, and owed once the worlds' was —, and nothing on a frame where nothing they read or write moved — no parent, no
 * link, and their motion settled (`encodeComposedMotion`). Into the roots' one compute pass
 * `open`, opened by the first that runs (`../../gpu/core/lazyComputePass.ts`). Whether the worlds
 * were composed anew: the root boxes pass derives the frame's composed roots' boxes from them.
 */
export function encodeComposedRoots(rt: WebgpuPagesRuntime, device: GPUDevice, open: OpenPass) {
  const state = rt.compose,
    gpu = frameParents(rt, device)
  // The worlds both read are the roots' double worlds (`../roots/rootWorlds.ts`), sent with the frame's rows.
  if (!state || !gpu?.parents || !rt.rootWorlds?.worlds || !state.rankList.count) return false
  const fresh = state.composedAt !== state.ranAt.worlds
  // The one parameters the worlds and roots passes read, made before their groups bind them, and
  // the groups, before the list is taken: one list a frame.
  writePassParams(device, gpu.params, state.roots, state.frameCount)
  const worlds = composeKernels.worlds(device).get()
  gpu.worldsGroup.identity.entries[0] ??= worldEntries(rt, gpu)
  const worldsBound = composeGroup(device, gpu.worldsGroup, worlds)
  const roots = rootsGroup(rt, device, gpu)
  // A group bound anew writes what its inputs held, the same, for every composed root: both passes
  // read the one list, sent before either is encoded. What the worlds pass writes anew is owed to
  // the passes that derive from it later: the roots composed since, every one into a worlds table
  // bound anew; a cut's worlds bound anew owe nothing.
  const rebound = worldsBound || !!roots?.bound
  if (rebound || fresh) {
    const taken = takeMoved(state.composed)
    sendFrame(device, gpu, state, rebound || !taken ? everyComposed(state) : taken)
    if (worldsBound || (fresh && !taken)) oweComposed(state, undefined)
    else if (fresh) oweComposed(state, taken)
  }
  writePassParams(device, gpu.params, state.roots, state.frameCount)
  const composed = fresh || worldsBound
  if (composed) {
    state.ranAt.worlds = state.composedAt
    if (state.frameCount) dispatchListed(rt, open, worlds, gpu.worldsGroup, state.frameCount)
  }
  if (roots) encodeRootsPass(rt, open, gpu, roots.pipeline, roots.bound)
  return composed
}

/** The roots pass's group over the cut's worlds, whether bound anew, and its pipeline; none
 *  without a cut. */
function rootsGroup(rt: WebgpuPagesRuntime, device: GPUDevice, gpu: ComposeGpu) {
  const selection = rt.run.gpuSelection
  if (!selection) return undefined
  const pipeline = composeKernels.roots(device).get(),
    held = gpu.rootGroup
  gpu.frame.worlds = selection.worlds
  held.identity.entries[0] ??= rootEntries(rt, gpu)
  const bound = composeGroup(device, held, pipeline)
  // The group is made: the cut's worlds are not held past it, so a cut swapped out goes.
  gpu.frame.worlds = undefined
  return { pipeline, bound }
}

/** The roots pass (`COMPOSE_ROOTS_WGSL`) into the cut's worlds: the frame's composed roots. */
function encodeRootsPass(
  rt: WebgpuPagesRuntime,
  open: OpenPass,
  gpu: ComposeGpu,
  pipeline: GPUComputePipeline,
  bound: boolean,
) {
  const state = rt.compose!,
    selection = rt.run.gpuSelection!
  // The worlds this pass writes are the ones the cut kernel reads next: no CPU world changed, so
  // no `updateWorlds` saw the turn, and the cut would keep the levels and frustum of the last full
  // write. A frame whose parents moved advances the selection's world revision, as a CPU pose
  // write does, and the dispatch that follows in this command buffer cuts again under them.
  if (state.moving && state.frameCount)
    selection.worldsMovedOnGpu(state.frameRanks.subarray(0, state.frameCount))
  const velocity = rt.gpu.velocity
  const motionBuffer = velocity?.active ? velocity.motion.buffer : undefined
  // A motion buffer bound anew holds rows the motion pass never wrote, and no reference it took:
  // every composed root is owed both.
  const { reference, motion } = state.owed
  if (motionBuffer !== state.ranAt.motion) reference.whole = motion.whole = true
  // Every word this pass writes is the one it wrote last, unless what it reads moved, its group
  // was bound anew — another cut's worlds —, or the motion is not settled — a root still owes its
  // reference or its motion row —: a still view of a composed scene costs no pass. A host write
  // of a composed root's world names it to the next composition
  // (`../../frame/render/worldUpload.ts`).
  const fresh = state.composedAt !== state.ranAt.roots
  const motionSettled = !motionBuffer || (isEmpty(reference) && isEmpty(motion))
  if (!fresh && !bound && motionSettled && motionBuffer === state.ranAt.motion) return
  state.ranAt.roots = state.composedAt
  state.ranAt.motion = motionBuffer
  // The motion this frame's motion pass writes once the temporal pass decided it, in the image's
  // own command buffer (`composedMotionPass.ts`): this one is submitted before the decision.
  state.motionBound = motionBuffer
  // A pass run for the motion alone rewrites no world.
  if ((fresh || bound) && state.frameCount)
    dispatchListed(rt, open, pipeline, gpu.rootGroup, state.frameCount)
}
