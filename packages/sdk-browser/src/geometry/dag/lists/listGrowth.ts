// THE CAMERA CUT'S READOUT MADE AGAIN (`growDagList`) for the open counts the visible list's room
// moves and the ranks its lists hold as the cut's demand moves them (`requestSize.ts`): a new
// readout made beside the old one within the cut's share, the open counts carried over, the old
// one retired by the one growth transaction (`../../../gpu/core/tableGrowth.ts`).
import { validated } from '../../../gpu/core/errorScope.ts'
import { bytesOfBuffers, pendingBuffers } from '../../../gpu/core/tableGrowth.ts'
import { DAG_READBACK_SLOTS, stagedOutputBytes } from '../layout.ts'
import { SELECTION_HEADER_WORDS } from '../readoutWords.ts'
import { pastBinding, readoutRow } from '../bufferTable.ts'
import { rebindCut } from '../recordsFollow.ts'
import { admitBeside } from '../cut/cutBuffers.ts'
import type { DagResources } from '../resources.ts'
import { HELD_BY_WORD } from '../frameTable.ts'
import { createDagList, heldOpenAt } from './listCap.ts'

/** The host's table of open counts written whole into `resources`' readout (`../heldOpen.ts`): at
 *  open, and into a readout made again — made again itself first when the readout holds more slots
 *  (`../queueGrowth.ts`), each placement whose count moved told in its frame words. A table laid out
 *  for other slots is not this cut's: its residency upload makes its own (`../residencyUpload.ts`). */
function writeHeldOpen(resources: DagResources, grown: boolean) {
  const held = resources.packed.heldOpen
  if (!held || !resources.heldSlots) return
  if (grown && held.slots < resources.heldSlots) {
    held.resize(resources.heldSlots)
    for (const w of held.takePlacements())
      resources.frames.writeWord(w, HELD_BY_WORD, held.heldBy(w))
    resources.frames.flushWords()
  }
  if (held.slots !== resources.heldSlots) return
  const at = (heldOpenAt(resources).base + SELECTION_HEADER_WORDS) * 4
  resources.device.queue.writeBuffer(resources.output, at, held.words)
}

/**
 * Gives the camera cut a readout of `listCap` ranks a list and `heldSlots` slots of open counts,
 * between two frames and with no readback in flight: a new readout, the bind groups that name it,
 * and the old one retired. Made under an out-of-memory scope, within one binding and, with the
 * readback ring the new ranks ask, within the cut's share: a device that cannot grant them keeps
 * the old readout whole and says `false`, so more open counts stay at their nodes' and the ranks
 * stay — rather than end on an error of the whole device. The pool's list, in the cold words'
 * table (`../cut/cutTables.ts`), keeps its own (`../layout.ts`).
 */
export async function growDagList(
  resources: DagResources,
  disposed: () => boolean,
  heldSlots = resources.heldSlots,
  listCap = resources.listCap,
) {
  if (pastBinding(resources.device.limits, { out: readoutRow(listCap, heldSlots) })) return false
  // The readback ring's own growth — its slots take the new ranks when next taken — is kept aside,
  // its budget asked now (`../mainReadbacks.ts`).
  const ring = Math.max(
    0,
    DAG_READBACK_SLOTS * stagedOutputBytes(listCap) - resources.readbacks.bytes,
  )
  return growCutBuffers(resources, {
    replaced: [resources.output],
    ring,
    create: (make) => createDagList(make, listCap, heldSlots),
    adopt: (list) => {
      const grown = heldSlots > resources.heldSlots
      Object.assign(resources, list)
      resources.group.out = list.output
      rebindCut(resources)
      // The lists were the old readout's: the cut that wrote them is owed no copy.
      resources.owner.outOwner = 0
      writeHeldOpen(resources, grown)
    },
    disposed,
  })
}

/**
 * THE ONE GROWTH TRANSACTION OF THE CUT'S BUFFERS: what `create` makes, through `make`, beside the
 * `replaced` buffers within the cut's share — each buffer noted in what the admission made, one past
 * the share never made, the growth refused by name (`pastShare`) — and under an out-of-memory
 * scope, the `ring` bytes its readbacks will ask kept aside and admitted now; then `adopt` puts it
 * in place, the cut's buffer list follows and `replaced` is freed at commit. False when the device
 * or the share refuses, or when `disposed` came meanwhile: nothing made outlives the call, the cut
 * keeps what it holds whole.
 */
export async function growCutBuffers<R>(
  resources: DagResources,
  grown: {
    replaced: readonly GPUBuffer[]
    ring?: number
    create: (make: (descriptor: GPUBufferDescriptor) => GPUBuffer) => R
    adopt: (made: R) => void
    disposed: () => boolean
  },
) {
  const { replaced, ring = 0 } = grown
  // What is replaced leaves the share: the new buffers are made within what remains.
  const admission = admitBeside<GPUBuffer>(resources, bytesOfBuffers(replaced), ring)
  const make = (descriptor: GPUBufferDescriptor) =>
    admission.admit({ label: descriptor.label, bytes: descriptor.size }, () =>
      resources.device.createBuffer(descriptor),
    )
  // A creation the device throws on is a refusal too.
  const result = await validated(
    resources.device,
    () => {
      if (ring > 0) resources.admit(ring)
      return grown.create(make)
    },
    'out-of-memory',
  ).catch(() => undefined)
  const growth = cutGrowth(
    resources,
    admission.made.map(({ resource }) => resource),
    replaced,
    () => grown.adopt(result!),
  )
  // Refused, or `dispose` came meanwhile: nothing made outlives this call.
  if (result === undefined || grown.disposed()) {
    growth.destroy()
    return false
  }
  growth.commit()
  return true
}

/**
 * The growth of the cut's buffers (`../../../gpu/core/tableGrowth.ts`): `made` replaces `replaced`, which
 * `adopt` puts in place; the cut's buffer list follows, and `replaced` is freed at commit.
 */
const cutGrowth = (
  resources: DagResources,
  made: readonly GPUBuffer[],
  replaced: readonly GPUBuffer[],
  adopt: () => void,
) =>
  pendingBuffers(resources.device, made, () => {
    adopt()
    resources.buffers.push(...made)
    for (const buffer of replaced) resources.buffers.splice(resources.buffers.indexOf(buffer), 1)
    return replaced
  })
