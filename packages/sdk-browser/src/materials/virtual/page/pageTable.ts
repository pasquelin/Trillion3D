import { lastAtMost } from '../../../../../math/src/scalar/search.ts'
import {
  entryLevel,
  MAX_LEVELS,
  packEntry,
  packPlace,
  type TileLayout,
  type TilePlace,
} from '../../texture/tiles.ts'
import { createPageUploads } from './pageUploads.ts'
import { descendTile } from './pageDescent.ts'
import { TRANSFORM_WORDS, samplingWords } from '../../texture/sampling.ts'
import type { Texture } from '../../../../../sdk-core/src/texture/contract.ts'

/**
 * Page table of an atlas: for each tile of each streamed level of each texture, the pool place
 * that serves it. That is the indirection the shader reads before every sample.
 *
 * An entry whose tile is missing is not empty: it points at the finest resident tile among its
 * ancestors — filled "downward" on every arrival, handed back to the next ancestor on every
 * departure — and zero means "nothing streamed, read the tail". The shader therefore never
 * searches: one read, one tile, always showable.
 *
 * One buffer per atlas, in words: `[feedback offset, textures, start of entries, start of
 * levels]`, ten words per texture (`width | height << 16`, first tail level under the texture's
 * residency bias — the level offset its reads add while the pools are oversubscribed, in sixteenths
 * of a level (`setSlotBias`) —, last level under the sampling word, tail place under the pool tap, UV
 * transform — `texture/sampling.ts`), sixteen per texture (each streamed level's first word), the entries. A flush sends the words that changed
 * (`pageUploads.ts`).
 */
export const PAGE_HEADER_WORDS = 4
/** Where a slot's residency bias lies in its first tail level's word, and how many steps it counts to a level. */
export const SLOT_BIAS_SHIFT = 8,
  SLOT_BIAS_STEPS = 16
export const PAGE_SLOT_WORDS = 4 + TRANSFORM_WORDS,
  PAGE_TRANSFORM_WORD = 4,
  PAGE_FILTER_SHIFT = 8
/** The word of a slot's header holding its last level and filter, and the ones holding its tail place and its first tail level. */
export const SLOT_FILTER_WORD = 2
const SLOT_TAIL_WORD = 3,
  SLOT_FIRST_TAIL_WORD = 1
/** The first word of texture `slot`'s header. */
export const slotHeader = (slot: number) => PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS

export type TileKey = { slot: number; level: number; tx: number; ty: number }

export type WebgpuTilePageTable = {
  readonly words: Uint32Array<ArrayBuffer>
  readonly entries: number
  readonly buffer: GPUBuffer
  /** Word of a streamed tile, as the shader will read it after `flush`. */
  entryOf(key: TileKey): number
  /** Feedback rank of a tile, and the inverse — both ends of the same list. */
  feedbackIndexOf(key: TileKey): number
  /** The tile of a feedback rank, written into `into` — a new key by default. */
  tileOf(feedbackIndex: number, into?: TileKey): TileKey
  /** The tail's place, and the tap every tile of the texture — this one included — is read by. */
  setTail(slot: number, place: TilePlace, tap: number): void
  setTile(key: TileKey, place: TilePlace): void
  /** Filter word, addressing and UV transform (`samplingWords`); true when a word moved. */
  setSampling(slot: number, texture: Texture): boolean
  /** The level offset every read of texture `slot` adds to its level, from the next flush. */
  setSlotBias(slot: number, levels: number): void
  clearTile(key: TileKey): void
  /** Sends the GPU what has changed; nothing when nothing moved. */
  flush(device: Pick<GPUDevice, 'queue'>): void
  destroy(): void
}

/** A table's words and where they lie — each texture's first entry, the entries' first word —, the
 *  layouts they describe and the words that changed since the last flush. */
type Table = {
  layouts: TileLayout[]
  words: Uint32Array<ArrayBuffer>
  bases: number[]
  entries: number
  entriesAt: number
  uploads: ReturnType<typeof createPageUploads>
}

/** The table of `layouts`: its header, each texture's words and its levels' first words, every
 *  entry zero — nothing streamed. */
function pageTable(layouts: TileLayout[], feedbackOffset: number): Table {
  const slots = layouts.length
  const levelsAt = PAGE_HEADER_WORDS + slots * PAGE_SLOT_WORDS,
    entriesAt = levelsAt + slots * MAX_LEVELS
  const bases: number[] = []
  let entries = 0
  for (const layout of layouts) {
    bases.push(entries)
    entries += layout.entries
  }
  const words = new Uint32Array(entriesAt + entries)
  words[0] = feedbackOffset
  words[1] = slots
  words[2] = entriesAt
  words[3] = levelsAt
  for (let slot = 0; slot < slots; slot++) {
    const layout = layouts[slot],
      header = slotHeader(slot)
    words[header] = layout.width | (layout.height << 16)
    words[header + SLOT_FIRST_TAIL_WORD] = layout.tail
    words[header + SLOT_FILTER_WORD] = layout.last
    // Level 0's first word even for a texture all tail: the starts climb with the slots, what the
    // stamp's search reads (`../stampWgsl.ts`); no read takes a level at or past the tail.
    words[levelsAt + slot * MAX_LEVELS] = entriesAt + bases[slot]
    for (let level = 1; level < layout.tail; level++)
      words[levelsAt + slot * MAX_LEVELS + level] = entriesAt + bases[slot] + layout.offsets[level]
  }
  return { layouts, words, bases, entries, entriesAt, uploads: createPageUploads() }
}

/** The index of the word of the tile (`slot`, `level`, `tx`, `ty`), unchecked. */
const entryIndex = (
  { layouts, entriesAt, bases }: Table,
  slot: number,
  level: number,
  tx: number,
  ty: number,
) => entriesAt + bases[slot] + layouts[slot].offsets[level] + ty * layouts[slot].across[level] + tx

/** The word of a streamed tile; a tile in the tail or off its level is refused. */
function wordIndex(table: Table, { slot, level, tx, ty }: TileKey) {
  const layout = table.layouts[slot]
  if (level >= layout.tail) throw new Error('TEXTURE_TILE_IN_TAIL')
  if (tx >= layout.across[level] || ty >= layout.down[level])
    throw new Error('TEXTURE_TILE_OUT_OF_LEVEL')
  return entryIndex(table, slot, level, tx, ty)
}

/** Writes `word` at `index`, marked for the next flush; true when it moved. */
function write({ words, uploads }: Table, index: number, word: number) {
  if (words[index] === word) return false
  words[index] = word
  uploads.mark(index)
  return true
}

const descend = (table: Table, key: TileKey, visit: (index: number) => boolean) =>
  descendTile(table.layouts[key.slot], table.entriesAt + table.bases[key.slot], key, visit)

/** The tile of entry `entry`, written into `into`: its texture by the entries' bases, then its level
 *  and place. */
function tileAt({ layouts, bases }: Table, entry: number, into: TileKey): TileKey {
  const lo = lastAtMost(bases, entry)
  const layout = layouts[lo],
    local = entry - bases[lo]
  let level = layout.tail - 1
  while (level > 0 && layout.offsets[level] > local) level--
  const tw = layout.across[level],
    rank = local - layout.offsets[level]
  into.slot = lo
  into.level = level
  into.tx = rank % tw
  into.ty = Math.floor(rank / tw)
  return into
}

/** Filter word, addressing and UV transform of texture `slot`; true when a word moved. */
function setSampling(table: Table, slot: number, texture: Texture) {
  const at = slotHeader(slot),
    sampling = samplingWords(texture)
  let moved = write(
    table,
    at + SLOT_FILTER_WORD,
    table.layouts[slot].last | (sampling[0] << PAGE_FILTER_SHIFT),
  )
  for (let i = 1; i <= TRANSFORM_WORDS; i++)
    moved = write(table, at + PAGE_TRANSFORM_WORD - 1 + i, sampling[i]) || moved
  return moved
}

function setTile(table: Table, key: TileKey, place: TilePlace) {
  const word = packEntry(place, key.level)
  write(table, wordIndex(table, key), word)
  // Downward: every finer entry served by a coarser ancestor, or by nothing, is better served
  // by this one; one served by this very tile at its former place — an atlas resize moves a
  // resident tile (`../atlas/atlasResize.ts`) — follows it to the new one.
  descend(table, key, (index) => {
    const current = table.words[index]
    if (current !== 0 && entryLevel(current) < key.level) return false
    write(table, index, word)
    return true
  })
}

/** The finest resident ancestor's word, or nothing: it is the one that takes back this entry and
 *  all the finer ones the leaving tile used to serve. An orphan edge tile — 769 texels make 7
 *  tiles, their half 3 — has no parent on a level where its coordinate falls outside: that level
 *  is skipped, as the descent from its tiles never reaches it (`pageDescent.ts`, #962). */
function finestAncestor(table: Table, key: TileKey) {
  const layout = table.layouts[key.slot]
  for (let level = key.level + 1; level < layout.tail; level++) {
    const shift = level - key.level,
      tw = layout.across[level],
      tx = key.tx >> shift,
      ty = key.ty >> shift
    if (tx >= tw || ty >= layout.down[level]) continue
    const word = table.words[entryIndex(table, key.slot, level, tx, ty)]
    if (word !== 0 && entryLevel(word) === level) return word
  }
  return 0
}

function clearTile(table: Table, key: TileKey) {
  const own = wordIndex(table, key),
    leaving = table.words[own]
  const replacement = finestAncestor(table, key)
  write(table, own, replacement)
  descend(table, key, (index) => {
    if (table.words[index] !== leaving) return false
    write(table, index, replacement)
    return true
  })
}

export function createWebgpuTilePageTable(
  device: Pick<GPUDevice, 'createBuffer' | 'queue'>,
  layouts: TileLayout[],
  options: { kind: 'color' | 'data'; feedbackOffset: number; upload?: boolean },
): WebgpuTilePageTable {
  const table = pageTable(layouts, options.feedbackOffset),
    { words, entries, entriesAt } = table
  const buffer = device.createBuffer({
    label: `Trillion3D texture pages ${options.kind}`,
    size: Math.max(16, words.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  if (options.upload !== false) device.queue.writeBuffer(buffer, 0, words)
  return {
    words,
    entries,
    buffer,
    entryOf: (key) => words[wordIndex(table, key)],
    feedbackIndexOf: (key) => wordIndex(table, key) - entriesAt + options.feedbackOffset,
    tileOf(feedbackIndex, into = { slot: 0, level: 0, tx: 0, ty: 0 }) {
      const entry = feedbackIndex - options.feedbackOffset
      if (entry < 0 || entry >= entries) throw new Error('TEXTURE_FEEDBACK_INDEX')
      return tileAt(table, entry, into)
    },
    setTail(slot, place, tap) {
      write(table, slotHeader(slot) + SLOT_TAIL_WORD, packPlace(place) | (tap << 24))
    },
    setSampling: (slot, texture) => setSampling(table, slot, texture),
    setSlotBias(slot, levels) {
      write(
        table,
        slotHeader(slot) + SLOT_FIRST_TAIL_WORD,
        table.layouts[slot].tail | (Math.round(levels * SLOT_BIAS_STEPS) << SLOT_BIAS_SHIFT),
      )
    },
    setTile: (key, place) => setTile(table, key, place),
    clearTile: (key) => clearTile(table, key),
    flush: (target) => table.uploads.flush(target.queue, buffer, words),
    destroy() {
      buffer.destroy()
    },
  }
}
