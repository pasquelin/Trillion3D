import type { ResidencyChanges } from '../core/selection.ts'
import { childBase, residentBase, residentWords } from './layout.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import type { PackedDag } from './types.ts'
import type { CameraFrames } from './frameRanges.ts'
import { OPEN_SLOT_WORDS, type HeldOpen } from './heldOpen.ts'
import { heldOpenAt } from './listCap.ts'
import { SELECTION_HEADER_WORDS } from './layout.ts'
import { HELD_BY_WORD } from './worlds.ts'
import { createDagReadiness } from './readiness.ts'
import { writeParts, writeRanges, type DagParts, type RangeTarget } from './split.ts'
import type { PageResidency } from '../core/selection.ts'

/**
 * One of the cut rule's residency bit sets: one word for thirty-two clusters, which is by itself
 * its own mirror — the comparison rereads the bit it is about to write, with no parallel array.
 * Only pages `changes` names are visited, all of them when there is none.
 * `touched` receives the word ranks touched, increasing and without repetition: those are what
 * the top writes, not the pages. Returns their count.
 */
export function updateResidencyBits(
  next: (page: number) => boolean,
  pageCount: number,
  bits: Uint32Array,
  base: number,
  changes: ResidencyChanges | undefined,
  touched: Int32Array,
) {
  let count = 0,
    last = -1
  const apply = (j: number) => {
    const word = j >>> 5,
      mask = 1 << (j & 31),
      current = bits[base + word]
    const value = next(j)
    if (((current & mask) !== 0) === value) return
    bits[base + word] = value ? current | mask : current & ~mask
    if (word === last) return
    touched[count++] = word
    last = word
  }
  if (changes) for (let i = 0; i < changes.count; i++) apply(changes.pages[i])
  else for (let j = 0; j < pageCount; j++) apply(j)
  return count
}

/** Both bit sets with nothing resident, written whole: cleared, then per placement, the bits its shared
 *  blank state raises (`readiness.blankPages`), the others already down. Costs the placements and
 *  the bits raised, never a readiness query per page. */
function writeBlankBits(
  packed: PackedDag,
  readiness: Pick<ReturnType<typeof createDagReadiness>, 'blankPages'>,
  bits: Uint32Array,
) {
  const sets = [residentBase(packed.pageCount), childBase(packed.pageCount)]
  bits.fill(0, sets[0], sets[0] + 2 * residentWords(packed.pageCount))
  for (let w = 0; w < packed.cutLinks.length; w++) {
    const { pageBase } = packed.cutLinks[w],
      { ready, child } = readiness.blankPages(w)
    ;[ready, child].forEach((offsets, set) => {
      for (const offset of offsets) {
        const page = pageBase + offset
        bits[sets[set] + (page >>> 5)] |= 1 << (page & 31)
      }
    })
  }
}

/** Where the open counts placements hold go: the readout's table and the placements' frame words
 *  (`heldOpen.ts`); a host with neither keeps them for the oracle alone. */
type HeldTarget = {
  output: GPUBuffer
  listCap: number
  heldSlots: number
  swap: { regions: number }
  frames: Pick<CameraFrames, 'writeWord' | 'flushWords'>
}

/**
 * The kernel's residency, kept by difference: the pool's per-page residency goes in, the cut
 * rule's two bit sets and the open counts the placements hold come out (`readiness.ts`), and only
 * the word ranges and table slots that changed are written, each page whose readiness moved handed
 * to `moved`. Returns whether anything did. Its change lists grow to the largest change seen,
 * never to the catalogue.
 */
export function createDagResidencyUpload(
  resources: { device: GPUDevice; packed: PackedDag; coldParts: DagParts } & Partial<HeldTarget>,
) {
  const { device, packed, coldParts } = resources,
    pageCount = packed.pageCount
  const readiness = createDagReadiness(packed, resources.heldSlots)
  const sendHeld = heldSender(device, resources, packed.heldOpen!)
  // The bits extend the cold records in their buffer: one view, mirror and write source.
  const bits = new Uint32Array(
    packed.pageCones.buffer,
    packed.pageCones.byteOffset,
    packed.pageCones.length,
  )
  /** Words or nodes the last apply changed, and the ranges that cover them. */
  let touched = new Int32Array(8)
  const changed = { pages: new Int32Array(8), count: 0 }
  const sets = [
    { values: readiness.isReady, base: residentBase(pageCount) },
    { values: readiness.isChildReady, base: childBase(pageCount) },
  ]
  /** One write per range of the `count` sorted ranks of `touched`, `stride` words each from
   *  `base` (`writeRanges`): a thousand small writes are not worth the single one they replace. */
  const upload = (
    target: DagParts,
    data: Float32Array,
    base: number,
    stride: number,
    count: number,
  ) =>
    writeRanges(device, target, touched, count, {
      data,
      sourceBase: base,
      targetBase: base,
      stride,
    })
  // Nothing is resident yet: both bit sets are written whole, once, from the readiness's state with
  // nothing resident; the node counts are the packing's own, uploaded with the nodes
  // (`packCullingNodes`). From then on only what moves is.
  writeBlankBits(packed, readiness, bits)
  const whole = (target: DagParts, source: Float32Array, from: number, words: number) =>
    writeParts(
      device,
      target,
      from * 4,
      source.buffer as ArrayBuffer,
      source.byteOffset + from * 4,
      words * 4,
    )
  whole(coldParts, packed.pageCones, residentBase(pageCount), 2 * residentWords(pageCount))
  const apply = (
    next: PageResidency,
    changes?: ResidencyChanges,
    moved?: (page: number) => void,
  ) => {
    const settled = readiness.apply(next, changes)
    const held = sendHeld()
    if (!settled.pages.length) return held
    if (moved) for (const page of settled.pages) moved(page)
    const most = settled.pages.length
    if (changed.pages.length < most) changed.pages = resized(changed.pages, most)
    if (touched.length < most) touched = resized(touched, most)
    changed.pages.set(settled.pages)
    changed.count = settled.pages.length
    for (const { values, base } of sets)
      upload(
        coldParts,
        packed.pageCones,
        base,
        1,
        updateResidencyBits(values, pageCount, bits, base, changed, touched),
      )
    return true
  }
  return Object.defineProperties(apply, {
    /** Bytes of the host tables: the readiness and this upload's change lists. */
    hostBytes: {
      get: () =>
        readiness.hostBytes +
        packed.heldOpen!.words.byteLength +
        touched.byteLength +
        changed.pages.byteLength,
    },
    /** The cut rule's residency of a packed page (`readiness.ts`). */
    isReady: { value: readiness.isReady },
    isChildReady: { value: readiness.isChildReady },
    /** The placements a growth appended join, nothing of theirs resident: each reads its nodes'
     *  own open counts (`runtime.ts`). */
    append: { value: readiness.append },
  }) as typeof apply & {
    readonly hostBytes: number
    readonly isReady: (page: number) => boolean
    readonly isChildReady: (page: number) => boolean
    readonly append: () => void
  }
}

/**
 * The sender of the open counts `held` holds to `target`: the slots written since the last send
 * into its readout's table, each run as one write (`writeRanges`), and the entry count of each
 * placement whose count moved into its frame word, which tells the kernel to read the table for it
 * (`HELD_BY_WORD`). Whether anything moved. Without a readout, nothing leaves the host.
 */
function heldSender(device: GPUDevice, target: Partial<HeldTarget>, held: HeldOpen) {
  return () => {
    const slots = held.takeSlots(),
      placements = held.takePlacements()
    if (!target.output || !target.frames || !target.heldSlots)
      return slots.length > 0 || placements.length > 0
    const { output, frames } = target
    const at = (heldOpenAt(target as HeldTarget).base + SELECTION_HEADER_WORDS) * 4
    const send: RangeTarget = (offset, data, dataOffset, size) =>
      device.queue.writeBuffer(output, at + offset, data, dataOffset, size)
    const source = { data: held.words, sourceBase: 0, targetBase: 0, stride: OPEN_SLOT_WORDS }
    writeRanges(device, send, slots, slots.length, source)
    for (const w of placements) frames.writeWord(w, HELD_BY_WORD, held.heldBy(w))
    if (placements.length) frames.flushWords()
    return slots.length > 0 || placements.length > 0
  }
}
