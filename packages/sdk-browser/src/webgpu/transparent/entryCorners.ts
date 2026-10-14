/**
 * THE TRANSPARENT ENTRIES' WORLD CORNERS, DERIVED ON THE GPU (`entryCornersWgsl.ts`), the rows pass's
 * second list: a transparent cluster claims no visibility row, so the occlusion test reads its own
 * corners, an entry each of the transparent table. An entry's inputs — its page's box grown by its
 * reach (`grownRowBox`) and its root's rank — are written when the entry is (a new table, a page
 * bounded elsewhere); its corners are derived from its root's world whenever that root moves, the
 * entries of a moved root alone, never the table.
 */
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { sizedBuffer } from '../../gpu/core/sizedBuffer.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { dispatchRows, WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { autoKernel } from '../../gpu/core/computeStages.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { liveBuffer } from '../core/liveEntries.ts'
import { COMPOSE_ROWS_PASS } from '../../stage/passLabels.ts'
import { composeGroup, heldGroup } from '../core/bindIdentity.ts'
import { passParams, writePassParams } from '../../gpu/core/passParams.ts'
import { grownRowBox } from '../../placement/rowInputPack.ts'
import { rootOf, rootOfPacked } from '../../page/selection/placements.ts'
import { neverCulled } from '../../visibility/shader/spriteWgsl.ts'
import { setBit } from '../../../../math/src/scalar/bits.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { TransparentOcclusion } from '../../gpu/core/transparentOcclusion.ts'
import { createChangedRuns } from '../residency/ranges.ts'
import { ENTRY_CORNERS_ENTRY, ENTRY_CORNERS_WGSL, ENTRY_INPUT_DOUBLES } from './entryCornersWgsl.ts'

const ENTRY_WORDS = ENTRY_INPUT_DOUBLES * 2
/** Entries one write sends at most: the scratch a run is packed in stays this size. */
const RUN_ENTRIES = 1024

/** The entries kernel, once a device, compiled off the thread (`askEntryCorners`). */
const entryKernel = autoKernel(COMPOSE_ROWS_PASS, ENTRY_CORNERS_WGSL, ENTRY_CORNERS_ENTRY)

/** Asks the entries kernel at a frame's entry once the scene holds a transparent table. */
export function askEntryCorners(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.blendState.table) entryKernel(device).ask()
}

export function createEntryCorners() {
  return {
    inputs: undefined as GPUBuffer | undefined,
    list: undefined as GPUBuffer | undefined,
    params: passParams('Trillion3D transparent entry params'),
    absent: undefined as GPUBuffer | undefined,
    scratch: new Uint32Array(0),
    box: new Float64Array(6),
    /** Every entry is derived at the next pass; else the first `count` of `targets`. */
    all: true,
    targets: new Uint32Array(16),
    count: 0,
    /** The corners buffer the inputs were last sent for: one made anew holds none. */
    corners: undefined as GPUBuffer | undefined,
    group: heldGroup(),
  }
}
type EntryCorners = ReturnType<typeof createEntryCorners>

/** The transparent table's occlusion test and what its corners were derived at, as the blend state
 *  holds them (`../blend/state.ts`). */
export function transparentOcclusionState() {
  return {
    /** Hi-Z test of transparent clusters, mounted after the pyramid it depends on. */
    occlusion: undefined as TransparentOcclusion | undefined,
    /** The age of the table the entries' corners were derived at, and the entries pass's state
     *  (`createEntryCorners`), made at its first image. */
    occlusionEpoch: -1,
    occlusionEntries: undefined as EntryCorners | undefined,
    /** The entries whose pages a rewrite bounded elsewhere since the corners were derived, their
     *  inputs sent again alone (`refreshTransparentCorners`); none when `to` is below `from`. */
    occlusionMoved: { from: Infinity, to: -1 },
    /** The entries whose placement moved since: derived again alone, from its world. */
    occlusionPosed: createChangedRuns(),
  }
}

/** Entry `entry` derived at the next pass. */
export function targetEntry(held: EntryCorners, entry: number) {
  if (held.all) return
  held.targets = resized(held.targets, held.count + 1)
  held.targets[held.count++] = entry
}

/** The inputs buffer at `capacity` entries, made again when it holds fewer: true then. */
export function ensureEntryInputs(device: GPUDevice, held: EntryCorners, capacity: number) {
  const bytes = Math.max(1, capacity) * ENTRY_WORDS * 4
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    old = held.inputs
  held.inputs = sizedBuffer(device, old, bytes, usage, 'Trillion3D transparent entry inputs')
  return held.inputs !== old
}

/** Entries `[from, to]`'s inputs sent, a write each `RUN_ENTRIES` entries: an entry naming no page,
 *  or a page no record holds, sends zero inputs. Each entry never culled sets its bit in `bits`. */
export function sendEntryInputs(
  rt: WebgpuPagesRuntime,
  held: EntryCorners,
  { from, to, bits }: { from: number; to: number; bits: Uint32Array },
) {
  const { recordOf, selectionRoots, placement } = rt.layout,
    { pageOfEntry } = rt.blendState.table!
  for (let first = from; first <= to; first += RUN_ENTRIES) {
    const last = Math.min(to, first + RUN_ENTRIES - 1),
      words = (held.scratch = resized(held.scratch, (last - first + 1) * ENTRY_WORDS))
    words.fill(0)
    for (let entry = first; entry <= last; entry++) {
      const page = pageOfEntry[entry],
        rec = page < 0 ? undefined : recordOf(page),
        at = (entry - first) * ENTRY_WORDS
      if (!rec) continue
      const rank = rootOfPacked(placement, page)
      grownRowBox(held.box, 0, rec, rootOf(selectionRoots, rank).reach)
      packDoubles(words, at, held.box)
      words[at + 12] = rank
      words[at + 14] = 1
      if (neverCulled(rec.material)) setBit(bits, entry)
    }
    const count = (last - first + 1) * ENTRY_WORDS
    rt.gpu.device!.queue.writeBuffer(held.inputs!, first * ENTRY_WORDS * 4, words, 0, count)
  }
}

/** The entries pass over the entries named since the last — every entry when `all` —, before the
 *  occlusion test reads their corners in `encoder`. Nothing when none was named. */
export function encodeEntryCorners(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  { held, corners, capacity }: { held: EntryCorners; corners: GPUBuffer; capacity: number },
) {
  const worlds = rt.rootWorlds?.worlds,
    listed = held.all ? capacity : held.count
  if (!listed || !worlds || !held.inputs) return
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
  held.absent ??= device.createBuffer({ label: 'Trillion3D no entry list', size: 16, usage })
  if (!held.all) {
    held.list = sizedBuffer(
      device,
      held.list,
      held.count * 4,
      usage,
      'Trillion3D transparent entry list',
    )
    device.queue.writeBuffer(held.list, 0, held.targets, 0, held.count)
  }
  writePassParams(device, held.params, rt.layout.selectionRoots.length, listed, held.all ? 1 : 0)
  const pipeline = entryKernel(device).get()
  held.group.identity.entries[0] ??= sequentialEntries([
    liveBuffer(() => held.params.buffer),
    liveBuffer(() => rt.rootWorlds?.worlds),
    liveBuffer(() => held.inputs),
    liveBuffer(() => held.corners),
    liveBuffer(() => held.list ?? held.absent),
  ])
  held.corners = corners
  composeGroup(device, held.group, pipeline)
  const pass = encoder.beginComputePass({ label: COMPOSE_ROWS_PASS })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, held.group.group!)
  dispatchRows(pass, ceilDiv(listed, WORKGROUP_THREADS))
  pass.end()
  rt.run.gpuComputeDispatches++
  held.all = false
  held.count = 0
}

/** The entries pass's buffers, destroyed with the transparent table. */
export function disposeEntryCorners(held: EntryCorners | undefined) {
  for (const buffer of [held?.inputs, held?.list, held?.params.buffer, held?.absent])
    buffer?.destroy()
}
