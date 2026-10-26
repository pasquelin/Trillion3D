import type { ResidencyChanges, PageResidency } from '../../gpu/core/selection.ts'
import { childBase, residentWords } from './layout.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { flipBit, hasBit, setBit } from '../../../../math/src/scalar/bits.ts'
import type { PackedDag } from './types.ts'
import type { CameraFrames } from './cameraFrames.ts'
import { OPEN_SLOT_WORDS, type HeldOpen } from './heldOpen.ts'
import { heldOpenAt } from './lists/listCap.ts'
import { SELECTION_HEADER_WORDS } from './readoutWords.ts'
import { HELD_BY_WORD } from './frameTable.ts'
import { createDagReadiness } from './readiness.ts'
import { bufferRangeTarget, writeRanges, type RangeTarget } from './runWrites.ts'

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
    if (hasBit(bits, j, base) === next(j)) return
    flipBit(bits, j, base)
    const word = j >>> 5
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
  const sets = [0, childBase(packed.pageCount)]
  bits.fill(0, 0, 2 * residentWords(packed.pageCount))
  for (let w = 0; w < packed.cutLinks.length; w++) {
    const { pageBase } = packed.cutLinks[w],
      { ready, child } = readiness.blankPages(w)
    ;[ready, child].forEach((offsets, set) => {
      for (const offset of offsets) setBit(bits, pageBase + offset, sets[set])
    })
  }
}

/** Where the open counts placements hold go: the readout's table and the placements' frame words
 *  (`heldOpen.ts`); a host with neither keeps them for the oracle alone. */
type HeldTarget = {
  output: GPUBuffer
  listCap: number
  heldSlots: number
  frames: Pick<CameraFrames, 'writeWord' | 'flushWords'>
}

/** What the upload holds: the packing, the readiness, the bits both sets extend the cold records
 *  with, the two bit sets, the words or nodes the last apply changed (`touched`) and the pages it
 *  changed (`changed`), which grow to the largest change seen. */
type Upload = {
  packed: PackedDag
  cold: RangeTarget
  readiness: ReturnType<typeof createDagReadiness>
  sendHeld: () => boolean
  bits: Uint32Array
  sets: { values: (page: number) => boolean; base: number }[]
  touched: Int32Array
  changed: { pages: Int32Array; count: number }
}

/** One write per range of the `count` sorted ranks of `touched`, `stride` words each from
 *  `base` (`writeRanges`): a thousand small writes are not worth the single one they replace. */
const upload = (u: Upload, data: Float32Array, base: number, stride: number, count: number) =>
  writeRanges(u.cold, u.touched, count, { data, sourceBase: base, targetBase: base, stride })

/** Whether a page of `changed` was ready, or its children were, and no longer is: it voids the cuts
 *  that may draw it, read on the bits before they follow; a page that only arrived, or whose
 *  children did, voids none. */
function withdrawnIn(u: Upload) {
  const { bits, readiness, changed } = u
  for (let i = 0; i < changed.count; i++) {
    const page = changed.pages[i]
    if (
      (hasBit(bits, page, 0) && !readiness.isReady(page)) ||
      (hasBit(bits, page, u.sets[1].base) && !readiness.isChildReady(page))
    )
      return true
  }
  return false
}

function applyResidency(
  u: Upload,
  next: PageResidency,
  changes?: ResidencyChanges,
  moved?: (page: number) => void,
) {
  const { packed, changed } = u
  const settled = u.readiness.apply(next, changes)
  const held = u.sendHeld()
  if (!settled.pages.length) return held && ('gained' as const)
  if (moved) for (const page of settled.pages) moved(page)
  const most = settled.pages.length
  if (changed.pages.length < most) changed.pages = resized(changed.pages, most)
  if (u.touched.length < most) u.touched = resized(u.touched, most)
  changed.pages.set(settled.pages)
  changed.count = settled.pages.length
  const withdrawn = withdrawnIn(u)
  for (const { values, base } of u.sets)
    upload(
      u,
      packed.coldWords,
      base,
      1,
      updateResidencyBits(values, packed.pageCount, u.bits, base, changed, u.touched),
    )
  return withdrawn ? ('withdrawn' as const) : ('gained' as const)
}

/**
 * The kernel's residency, kept by difference: the pool's per-page residency goes in, the cut
 * rule's two bit sets and the open counts the placements hold come out (`readiness.ts`), and only
 * the word ranges and table slots that changed are written, each page whose readiness moved handed
 * to `moved`. Returns whether anything did. Its change lists grow to the largest change seen,
 * never to the catalogue.
 */
export function createDagResidencyUpload(
  resources: { device: GPUDevice; packed: PackedDag; cold: RangeTarget } & Partial<HeldTarget>,
) {
  const { device, packed, cold } = resources,
    pageCount = packed.pageCount
  const readiness = createDagReadiness(packed, resources.heldSlots)
  const { coldWords } = packed
  const u: Upload = {
    packed,
    cold,
    readiness,
    sendHeld: heldSender(device, resources, packed.heldOpen!),
    // The bits extend the cold records in their buffer: one view, mirror and write source.
    bits: new Uint32Array(coldWords.buffer, coldWords.byteOffset, coldWords.length),
    sets: [
      { values: readiness.isReady, base: 0 },
      { values: readiness.isChildReady, base: childBase(pageCount) },
    ],
    touched: new Int32Array(8),
    changed: { pages: new Int32Array(8), count: 0 },
  }
  // Nothing is resident yet: both bit sets are written whole, once, from the readiness's state with
  // nothing resident; the node counts are the packing's own, uploaded with the nodes
  // (`packCullingNodes`). From then on only what moves is.
  writeBlankBits(packed, readiness, u.bits)
  cold(0, coldWords.buffer as ArrayBuffer, coldWords.byteOffset, 2 * residentWords(pageCount) * 4)
  const apply = (next: PageResidency, changes?: ResidencyChanges, moved?: (page: number) => void) =>
    applyResidency(u, next, changes, moved)
  return Object.defineProperties(apply, {
    /** Bytes of the host tables: the readiness and this upload's change lists. */
    hostBytes: {
      get: () =>
        readiness.hostBytes +
        packed.heldOpen!.words.byteLength +
        u.touched.byteLength +
        u.changed.pages.byteLength,
    },
    /** The cut rule's residency of a packed page (`readiness.ts`). */
    isReady: { value: readiness.isReady },
    isChildReady: { value: readiness.isChildReady },
    /** The placements a growth appended join, nothing of theirs resident: each reads its nodes'
     *  own open counts (`runtime/runtime.ts`). */
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
    const send = bufferRangeTarget(device, output, at)
    const source = { data: held.words, sourceBase: 0, targetBase: 0, stride: OPEN_SLOT_WORDS }
    writeRanges(send, slots, slots.length, source)
    for (const w of placements) frames.writeWord(w, HELD_BY_WORD, held.heldBy(w))
    if (placements.length) frames.flushWords()
    return slots.length > 0 || placements.length > 0
  }
}
