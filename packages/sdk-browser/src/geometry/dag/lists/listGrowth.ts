// THE CAMERA CUT'S READOUT MADE AGAIN (`growDagList`) for the regions the views aside ask, the
// open counts the row cache holds and the ranks its lists hold as the cut's demand moves them
// (`requestSize.ts`): a new readout and its kept ranks made beside the old ones within the cut's
// share, the kept snapshot and the open counts carried over, the old ones retired by the one growth
// transaction (`../../../gpu/core/tableGrowth.ts`).
import { validated } from '../../../gpu/core/errorScope.ts'
import { bytesOfBuffers, pendingBuffers } from '../../../gpu/core/tableGrowth.ts'
import {
  DAG_READBACK_SLOTS,
  KEPT_HEADER_WORDS,
  keptSnapshotWord,
  residentReadbackBytes,
} from '../layout.ts'
import { SELECTION_HEADER_WORDS } from '../readoutWords.ts'
import { pastBinding, readoutRow } from '../bufferTable.ts'
import { admitBeside } from '../cut/cutBuffers.ts'
import { DAG_PASS } from '../encodeDifference.ts'
import type { DagResources } from '../resources.ts'
import { newRegions } from '../swap/swap.ts'
import { HELD_BY_WORD } from '../frameTable.ts'
import { viewWord } from '../viewLayout.ts'
import { dispatchRows, groupWidth, WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { workgroupCount } from '../../../../../math/src/scalar/integers.ts'
import { createDagList, heldOpenAt, rankGroups } from './listCap.ts'

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
 * Gives the camera cut a readout of `listCap` ranks a list, `regions` saved journals and
 * `heldSlots` slots of open counts, between two frames and with no readback in flight: a new
 * readout, the bind groups that name it, and the old ones retired. Made under an out-of-memory
 * scope, within one binding and, with the readback ring the new ranks ask, within the cut's share:
 * a device that cannot grant them keeps the old readout whole and says `false`, so the views aside
 * cut without a region, more open counts stay at their nodes' and the ranks stay — rather than end
 * on an error of the whole device. The pool's list, in the cold words' table
 * (`../cut/cutTables.ts`), keeps its own (`../layout.ts`).
 */
export async function growDagList(
  resources: DagResources,
  regions: number,
  disposed: () => boolean,
  heldSlots = resources.heldSlots,
  listCap = resources.listCap,
) {
  if (pastBinding(resources.device.limits, { out: readoutRow(listCap, regions, heldSlots) }))
    return false
  // What the readout replaces leaves the share: the new one is made within what remains, and the
  // readback ring's own growth — its slots take the new ranks when next taken — is kept aside,
  // its budget asked now (`../mainReadbacks.ts`).
  const replaced = [resources.output, ...resources.ranks]
  const ring = Math.max(
    0,
    DAG_READBACK_SLOTS * residentReadbackBytes(listCap) - resources.readbacks.bytes,
  )
  const admission = admitBeside<GPUBuffer>(resources, bytesOfBuffers(replaced), ring)
  // Each buffer noted in what the admission made: one past the share is never made, and the growth
  // is refused by name (`pastShare`).
  const make = (descriptor: GPUBufferDescriptor) =>
    admission.admit({ label: descriptor.label, bytes: descriptor.size }, () =>
      resources.device.createBuffer(descriptor),
    )
  // A creation the device throws on is a refusal too.
  const list = await validated(
    resources.device,
    () => {
      if (ring > 0) resources.admit(ring)
      return createDagList(make, listCap, regions, heldSlots)
    },
    'out-of-memory',
  ).catch(() => undefined)
  const made = admission.made.map(({ resource }) => resource)
  const growth = cutGrowth(resources, made, replaced, () => {
    const from = { output: resources.output, listCap: resources.listCap },
      grown = heldSlots > resources.heldSlots
    Object.assign(resources, list)
    resources.group.out = list!.output
    resources.bindGroup = resources.frames.bindGroup(resources.layout, resources.group)
    resources.rankGroups = rankGroups(resources)
    // The saved journals and the lists were the old readout's (`../swap/swap.ts`).
    newRegions(resources.swap, regions)
    writeHeldOpen(resources, grown)
    carryKeptSnapshot(resources, from)
  })
  // Refused, or `dispose` came meanwhile: nothing made outlives this call.
  if (!list || disposed()) {
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

/**
 * The kept snapshot carried from the readout `from` into the one made again, `to`'s — its lengths
 * and both lists, each at the place its list's cap lays it (`keptSnapshotWord`), the ranks both
 * caps hold —, then each list ranked in its new table (`../shader/differenceWgsl.ts`,
 * `dagCutRekeep`; its kernels read the new cap, written first, and a length past it is cut to it):
 * the next copy's difference is taken against it as before, and the readbacks since keep naming
 * their pages by its ranks (`../differenceChain.ts`).
 */
function carryKeptSnapshot(to: DagResources, from: { output: GPUBuffer; listCap: number }) {
  const { device } = to,
    encoder = device.createCommandEncoder(),
    least = Math.min(from.listCap, to.listCap),
    a = keptSnapshotWord(from.listCap) * 4,
    b = keptSnapshotWord(to.listCap) * 4
  encoder.copyBufferToBuffer(from.output, a, to.output, b, KEPT_HEADER_WORDS * 4)
  for (let l = 0; l < 2; l++)
    encoder.copyBufferToBuffer(
      from.output,
      a + (KEPT_HEADER_WORDS + l * from.listCap) * 4,
      to.output,
      b + (KEPT_HEADER_WORDS + l * to.listCap) * 4,
      least * 4,
    )
  const word = viewWord('listCap')
  to.uniformWords[word] = to.listCap
  device.queue.writeBuffer(to.uniforms, word * 4, to.uniformWords, word, 1)
  const pass = encoder.beginComputePass(DAG_PASS)
  to.rekeepPipelines.forEach((pipeline, l) => {
    pass.setBindGroup(0, to.rankGroups[l])
    pass.setPipeline(pipeline)
    dispatchRows(pass, workgroupCount(least, WORKGROUP_THREADS), 1, groupWidth(device.limits))
  })
  pass.end()
  device.queue.submit([encoder.finish()])
}
