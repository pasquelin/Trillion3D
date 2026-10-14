// THE CAMERA CUT'S LIST GROWN (`growDagList`): a new readout and its kept ranks made beside the
// old ones within the cut's share, the kept snapshot and the open counts carried over, the old
// ones retired by the one growth transaction (`../core/tableGrowth.ts`).
import { validationScope } from '../core/errorScope.ts'
import { pendingBuffers } from '../core/tableGrowth.ts'
import {
  DAG_READBACK_SLOTS,
  KEPT_HEADER_WORDS,
  keptSnapshotWord,
  residentReadbackBytes,
} from './layout.ts'
import { SELECTION_HEADER_WORDS } from './readoutWords.ts'
import { readoutRow } from './bufferTable.ts'
import { admitBeside } from './cutBuffers.ts'
import type { DagResources } from './resources.ts'
import { newRegions } from './swap.ts'
import { storageBufferCap } from '../../residency/pools.ts'
import { HELD_BY_WORD } from './frameTable.ts'
import { viewWord } from './viewLayout.ts'
import { dispatchRows, groupWidth, WORKGROUP_THREADS } from '../dispatch/grid.ts'
import { workgroupCount } from '../../../../math/src/scalar/integers.ts'
import { createDagList, heldOpenAt, rankGroups } from './listCap.ts'

/** The host's table of open counts written whole into `resources`' readout (`heldOpen.ts`): at
 *  open, and into a readout made again — made again itself first when the readout holds more slots
 *  (`queueGrowth.ts`), each placement whose count moved told in its frame words. A table laid out
 *  for other slots is not this cut's: its residency upload makes its own (`residencyUpload.ts`). */
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
 * Gives the camera cut a list of `listCap` ranks, `regions` saved journals and `heldSlots` slots of
 * open counts, between two frames and with no readback in flight: a new readout, the bind groups
 * that name it, and the old ones retired — the readback ring takes the new size at its next copy.
 * Made under an out-of-memory scope, within one binding: a device that cannot grant them keeps the
 * old readout whole and says `false`, so the next truncated readout coarsens its cut
 * (`coarsening.ts`) — or the views aside cut without a region — rather than end on an error of the
 * whole device. The kernels read the cap from the uniforms (`uniforms.ts`); the pool's list, in
 * the cold words' table (`cutTables.ts`), keeps its own (`layout.ts`).
 */
export async function growDagList(
  resources: DagResources,
  listCap: number,
  regions: number,
  disposed: () => boolean,
  heldSlots = resources.heldSlots,
) {
  const bytes = readoutRow(listCap, regions, heldSlots).size
  if (bytes > storageBufferCap(resources.device.limits)) return false
  // What the readout replaces leaves the share: the new one is made within what remains.
  const replaced = [resources.output, ...resources.ranks]
  // The ring's next copies take the grown size: kept in the share, asked now (`mainReadbacks.ts`).
  const ring = DAG_READBACK_SLOTS * residentReadbackBytes(listCap) - resources.readbacks.bytes
  const admission = admitBeside<GPUBuffer>(
    resources,
    replaced.reduce((sum, buffer) => sum + buffer.size, 0),
    Math.max(0, ring),
  )
  // Each buffer noted in what the admission made: one past the share is never made, and the growth
  // is refused by name (`pastShare`): the view coarsens instead (`coarsening.ts`).
  const make = (descriptor: GPUBufferDescriptor) =>
    admission.admit({ label: descriptor.label, bytes: descriptor.size }, () =>
      resources.device.createBuffer(descriptor),
    )
  let list: ReturnType<typeof createDagList> | undefined
  try {
    const { value, error } = await validationScope(
      resources.device,
      () => {
        if (ring > 0) resources.admit(ring)
        return createDagList(make, listCap, regions, heldSlots)
      },
      'out-of-memory',
    )
    if (!error) list = value
  } catch {
    /* A creation the device throws on is a refusal too. */
  }
  const made = admission.made.map(({ resource }) => resource)
  const growth = cutGrowth(resources, made, replaced, () => {
    const from = { output: resources.output, listCap: resources.listCap },
      grown = heldSlots > resources.heldSlots
    Object.assign(resources, list)
    resources.group.out = list!.output
    resources.bindGroup = resources.frames.bindGroup(resources.layout, resources.group)
    resources.rankGroups = rankGroups(resources)
    // The saved journals and the lists were the old readout's (`swap.ts`).
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
 * The growth of the cut's buffers (`../core/tableGrowth.ts`): `made` replaces `replaced`, which
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
 * The kept snapshot carried into the grown readout `to`, lengths and both lists, each at the place
 * the new cap gives it (`keptSnapshotWord`), then each list ranked in its new table
 * (`shader/differenceWgsl.ts`, `dagCutRekeep`) — the kernels read the new cap, written first —:
 * the next copy's difference is taken against it as if the list had not grown, and the readbacks
 * since keep naming their pages by its ranks (`differenceChain.ts`).
 */
function carryKeptSnapshot(to: DagResources, from: { output: GPUBuffer; listCap: number }) {
  const { device } = to,
    encoder = device.createCommandEncoder(),
    a = keptSnapshotWord(from.listCap) * 4,
    b = keptSnapshotWord(to.listCap) * 4,
    asked = (KEPT_HEADER_WORDS + from.listCap) * 4
  encoder.copyBufferToBuffer(from.output, a, to.output, b, asked)
  encoder.copyBufferToBuffer(
    from.output,
    a + asked,
    to.output,
    b + (KEPT_HEADER_WORDS + to.listCap) * 4,
    from.listCap * 4,
  )
  device.queue.writeBuffer(to.uniforms, viewWord('listCap') * 4, Uint32Array.of(to.listCap))
  const pass = encoder.beginComputePass({ label: 'Trillion3D DAG selection' })
  to.rekeepPipelines.forEach((pipeline, l) => {
    pass.setBindGroup(0, to.rankGroups[l])
    pass.setPipeline(pipeline)
    dispatchRows(
      pass,
      workgroupCount(from.listCap, WORKGROUP_THREADS),
      1,
      groupWidth(device.limits),
    )
  })
  pass.end()
  device.queue.submit([encoder.finish()])
}
