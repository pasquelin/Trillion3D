/**
 * THE TRANSPARENT ENTRIES' WORLD CORNERS, DERIVED ON THE GPU (`entryCornersWgsl.ts`), the rows pass's
 * second list: a transparent cluster claims no visibility row, so the occlusion test reads its own
 * corners, an entry each of the transparent table. An entry's inputs — its page's box grown by its
 * reach (`grownRowBox`) and its root's rank — are written when the entry is (a new table, a page
 * bounded elsewhere); its corners are derived from its root's world whenever that root moves, the
 * entries of a moved root alone, never the table.
 */
import { packDoubles } from '../../../../math/src/float/splitDouble.ts'
import { grownLength, resized } from '../../../../math/src/sequence/resized.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { dispatchRows } from '../../gpu/dispatch/grid.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedComputePipeline } from '../../lighting/deferred/fullscreen.ts'
import { sequentialEntries } from '../../gpu/core/computeBindings.ts'
import { liveBuffer } from '../core/liveEntries.ts'
import { COMPOSE_ROWS_PASS } from '../../stage/passLabels.ts'
import { composeGroup, heldGroup } from '../../placement/composeGroups.ts'
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
const entryKernel = oncePerDevice((device) =>
  preparedComputePipeline(device, {
    label: COMPOSE_ROWS_PASS,
    layout: 'auto',
    compute: {
      module: device.createShaderModule({ label: COMPOSE_ROWS_PASS, code: ENTRY_CORNERS_WGSL }),
      entryPoint: ENTRY_CORNERS_ENTRY,
    },
  }),
)

/** Asks the entries kernel at a frame's entry once the scene holds a transparent table. */
export function askEntryCorners(rt: WebgpuPagesRuntime, device: GPUDevice) {
  if (rt.blendState.table) entryKernel(device).ask()
}

export function createEntryCorners() {
  return {
    inputs: undefined as GPUBuffer | undefined,
    list: undefined as GPUBuffer | undefined,
    params: undefined as GPUBuffer | undefined,
    absent: undefined as GPUBuffer | undefined,
    words: new Uint32Array(4),
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
export type EntryCorners = ReturnType<typeof createEntryCorners>

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
  if (held.inputs && held.inputs.size >= bytes) return false
  held.inputs?.destroy()
  held.inputs = device.createBuffer({
    label: 'Trillion3D transparent entry inputs',
    size: grownLength(held.inputs?.size ?? 0, bytes),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  return true
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
  held.params ??= device.createBuffer({
    label: 'Trillion3D transparent entry params',
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  held.absent ??= device.createBuffer({ label: 'Trillion3D no entry list', size: 16, usage })
  if (!held.all && (!held.list || held.list.size < held.count * 4)) {
    held.list?.destroy()
    held.list = device.createBuffer({
      label: 'Trillion3D transparent entry list',
      size: grownLength(held.list?.size ?? 0, held.count * 4),
      usage,
    })
  }
  if (!held.all) device.queue.writeBuffer(held.list!, 0, held.targets, 0, held.count)
  const { words } = held
  words[0] = rt.layout.selectionRoots.length
  words[1] = listed
  words[2] = held.all ? 1 : 0
  device.queue.writeBuffer(held.params, 0, words)
  const pipeline = entryKernel(device).get()
  held.group.identity.entries[0] ??= sequentialEntries([
    liveBuffer(() => held.params),
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
  dispatchRows(pass, ceilDiv(listed, 64))
  pass.end()
  rt.run.gpuComputeDispatches++
  held.all = false
  held.count = 0
}

/** The entries pass's buffers, destroyed with the transparent table. */
export function disposeEntryCorners(held: EntryCorners | undefined) {
  for (const buffer of [held?.inputs, held?.list, held?.params, held?.absent]) buffer?.destroy()
}
