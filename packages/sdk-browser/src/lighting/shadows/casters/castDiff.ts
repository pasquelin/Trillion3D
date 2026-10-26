/**
 * THE DIFF OF THE INSTANCES' BOXES ENCODED (`castDiffWgsl.ts`): each frame a light casts and a
 * placement may have changed, one thread a placement compares its world box and its word with the
 * ones it was seen with, and appends the boxes whose pages the shadow maps must draw again to the
 * shadow changes (`castChanges.ts`), which the invalidation then reads
 * (`../vsm/invalidation/castInvalidation.ts`). The reference collects the instances that moved,
 * appeared or left from the scene's updates and invalidates each by its previous and its new bounds;
 * the placements' worlds here move on the GPU too (a parent composing them), so the comparison is the
 * GPU's, against the boxes the roots pass derives (`../../../placement/roots/rootBoxes.ts`).
 *
 * It runs when the event the reference follows may have happened — a placement's world was written
 * (the roots pass wrote boxes), a placement's word was written, the roots grew — and never otherwise:
 * a still scene pays no thread. What it followed is
 * remembered when it is encoded, so a frame that never encodes it leaves the next one to.
 */
import { ceilDiv } from '../../../../../math/src/scalar/integers.ts'
import type { ComputeRun } from '../../../gpu/core/lazyComputePass.ts'
import { autoKernel } from '../../../gpu/core/computeStages.ts'
import { composeGroup, heldGroup } from '../../../gpu/bind/bindIdentity.ts'
import { sequentialEntries } from '../../../gpu/core/computeBindings.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { VSM_PASS_PREFIX } from '../../../diagnostic/stage/passLabels.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'
import { VSM_DEFAULT_SHADOWS } from '../vsm/mapSettings.ts'
import type { ShadowValues } from '../../../../../sdk-core/src/contracts/shadowOptions.ts'
import {
  castStateMadeAnew,
  createCastChanges,
  ensureCastState,
  reserveCasts,
  type CastChanges,
} from './castChanges.ts'
import {
  CAST_DIFF_ENTRY,
  CAST_DIFF_PARAMS_BYTES,
  CAST_DIFF_WGSL,
  CAST_INSTANCE_STATE_ENTRY,
} from './castDiffWgsl.ts'
import { uploadRootWords } from './rootWords.ts'

const LABEL = `${VSM_PASS_PREFIX}castDiff`
const DIFF_PASS: GPUComputePassDescriptor = { label: LABEL }
/** The runs of the state per view an event owes: the one that sets its transitions, the one that clears them. */
const STATE_RUNS = 2

/** The kernels, once a device, compiled off the thread: the diff, and the instances' state per view. */
const kernel = autoKernel(LABEL, CAST_DIFF_WGSL, CAST_DIFF_ENTRY)
const stateKernel = autoKernel(`${LABEL}.state`, CAST_DIFF_WGSL, CAST_INSTANCE_STATE_ENTRY)

/** The kernels as stages of the frame's chain (`framePipelines`): the diff writes the list the stale
 *  reads and the memory the next diff compares with, so a frame plans no shadow while one compiles —
 *  a frame drawn without its diff caches pages whose poses no memory holds, and nothing ever stales
 *  them. */
export const castDiffStages = (device: GPUDevice) => [kernel(device), stateKernel(device)]

/** The kernels compiled off the thread before the first lit frame, with the other shadow pipelines
 *  (`prepareVsmPipelines`): no frame compiles them. */
export const prepareCastDiff = (device: GPUDevice) =>
  Promise.all([kernel(device).prepare(), stateKernel(device).prepare()]).then(() => undefined)

/** What a frame's diff is asked with: the placements it runs over, and whether it only remembers
 *  them (the memory was made anew: no placement was seen, none is named). */
export interface CastDiffAsk {
  roots: number
  quiet: boolean
  /** Whether the diff of the boxes runs: something may have changed. */
  diff: boolean
  /** Whether the instances' state per view runs: a word was written, the placements or the views
   *  changed, or the transitions of the last run are still to clear (they last one frame). */
  state: boolean
  /** The views drawn: the bits of the state a placement holds. */
  views: number
}

/** The diff on one device: its parameters, its group over the buffers it names, those buffers. */
function createCastDiffGpu(device: GPUDevice) {
  const params = device.createBuffer({
    label: `${LABEL}.params`,
    size: CAST_DIFF_PARAMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const named: GPUBufferBinding[] = Array.from({ length: 6 }, () => ({ buffer: params })),
    held = heldGroup(),
    heldState = heldGroup()
  held.identity.entries[0] = sequentialEntries(named)
  heldState.identity.entries[0] = sequentialEntries(named)
  return {
    device,
    params,
    named,
    held,
    heldState,
    words: new Uint32Array(CAST_DIFF_PARAMS_BYTES / 4),
  }
}
type CastDiffGpu = ReturnType<typeof createCastDiffGpu>
const gpus = new WeakMap<CastChanges, CastDiffGpu>()

/** Frees what the diff of `casts` holds on its device, with the session. */
export function releaseCastDiff(casts: CastChanges | undefined) {
  const gpu = casts && gpus.get(casts)
  if (!casts || !gpu) return
  gpu.params.destroy()
  gpus.delete(casts)
}

/**
 * What the shadows follow of the placements this frame, on the CPU, before the plan reads whether
 * anything changed: the placements that settled turn static (`shadowCacheFramesStaticThreshold`, the
 * frames without an invalidation), their words and the others' are written, the diff's
 * memory made and grown with the roots, and room asked for the records the diff may append. The ask
 * the frame's diff is encoded with (`encodeCastDiff`), none when nothing can have changed: the
 * roots pass wrote no world since the last diff, no word was written, the roots are the same.
 */
export function followRoots(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  shadows: ShadowValues = VSM_DEFAULT_SHADOWS,
): CastDiffAsk | null {
  const { lights, rootWorlds } = rt
  lights.mobility.settle(shadows.shadowCacheFramesStaticThreshold)
  const wrote = uploadRootWords(rt, device)
  const roots = rootWorlds?.held ?? 0
  if (!roots || !rootWorlds?.boxes || !lights.rootWords) return null
  const casts = (lights.casts ??= createCastChanges(device))
  const fresh = ensureCastState(casts, device, roots)
  if (fresh) castStateMadeAnew(lights)
  if (wrote) casts.owed = true
  // The event the reference follows, a primitive's transform updated: a world written since the diff
  // last ran — a host move, a parent's composition — has the roots pass derive boxes; a word written,
  // or roots grown, is the other event.
  const written = rt.rootBoxes?.written ?? 0
  const diff =
    fresh || casts.owed || casts.followedRoots !== roots || casts.followedWrites !== written
  const views = lights.vsm?.state.cache.viewCount ?? 1
  // The state per view changes with the words (the deforming flag), and starts to track a view or a
  // placement at its first run: it runs then, and once more to clear the transitions it set.
  if (fresh || wrote || casts.stateFollowedRoots !== roots || casts.stateFollowedViews !== views) {
    casts.stateOwed = STATE_RUNS
    casts.stateFollowedRoots = roots
    casts.stateFollowedViews = views
  }
  // Every placement may append its two boxes; one whose state turned to dynamic, a box more.
  if (!fresh) reserveCasts(casts, device, (diff ? 3 : 1) * roots, roots)
  return { roots, quiet: fresh, diff, state: casts.stateOwed > 0, views }
}

/** The diff over `ask.roots` placements, into `encoder`: its parameters written, its group over the
 *  boxes the roots pass derived, the words, its memory and the list. Nothing while its kernel
 *  compiles: the memory is then left as it is, and the next diff names what changed meanwhile. */
export function encodeCastDiff(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  steps: ComputeRun,
  ask: CastDiffAsk,
) {
  const { lights, rootWorlds } = rt,
    casts = lights.casts
  const boxes = rootWorlds?.boxes,
    worlds = rootWorlds?.worlds,
    words = lights.rootWords,
    state = casts?.state
  if (!casts || !boxes || !worlds || !words || !state) return
  // A still scene runs neither kernel: no pass, no upload.
  if (!ask.diff && !ask.state) return
  const compiled = kernel(device),
    stated = stateKernel(device)
  const pipeline = compiled.get(),
    statePipeline = stated.get()
  // The memory stays as it was while the kernels compile: the next diff compares against it.
  if (!pipeline || !statePipeline) {
    void Promise.all([compiled.prepare(), stated.prepare()]).catch(() => {})
    return
  }
  let gpu = gpus.get(casts)
  if (gpu?.device !== device) {
    gpu?.params.destroy()
    gpus.set(casts, (gpu = createCastDiffGpu(device)))
  }
  gpu.words[0] = ask.roots
  gpu.words[1] = ask.quiet ? 1 : 0
  gpu.words[2] = ask.views
  device.queue.writeBuffer(gpu.params, 0, gpu.words)
  const { named } = gpu
  named[1].buffer = boxes
  named[2].buffer = words
  named[3].buffer = state
  named[4].buffer = casts.buffer
  named[5].buffer = worlds
  const pass = steps.pass(DIFF_PASS)
  const threads = ceilDiv(ask.roots, WORKGROUP_THREADS)
  if (ask.diff) {
    composeGroup(device, gpu.held, pipeline)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, gpu.held.group!)
    dispatchRows(pass, threads)
  }
  if (ask.state) {
    // The state after the diff: it reads the words the diff remembers, not its results.
    composeGroup(device, gpu.heldState, statePipeline)
    pass.setPipeline(statePipeline)
    pass.setBindGroup(0, gpu.heldState.group!)
    dispatchRows(pass, threads)
  }
  if (ask.state) casts.stateOwed--
  if (ask.diff) {
    casts.followedRoots = ask.roots
    casts.followedWrites = rt.rootBoxes?.written ?? 0
    casts.owed = false
  }
}
