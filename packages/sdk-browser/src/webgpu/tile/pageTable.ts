import {
  entryLevel,
  MAX_LEVELS,
  packEntry,
  packPlace,
  tilesAt,
  type TileLayout,
  type TilePlace,
} from '../../texture/tiles.ts'
import { createPageUploads } from './pageUploads.ts'
import { descendTile } from './pageDescent.ts'
import { TRANSFORM_WORDS, samplingWords } from '../../texture/sampling.ts'
import type { Texture } from '../../../../sdk-core/src/index.ts'

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
 * levels]`, ten words per texture (`width | height << 16`, first tail level, last level under the
 * sampling word, tail place under the pool tap, UV transform — `sampling.ts`), sixteen per texture
 * (each streamed level's first word), the entries. A flush sends the words that changed
 * (`pageUploads.ts`).
 */
export const PAGE_HEADER_WORDS = 4
export const PAGE_SLOT_WORDS = 4 + TRANSFORM_WORDS,
  PAGE_TRANSFORM_WORD = 4,
  PAGE_FILTER_SHIFT = 8

export type TileKey = { slot: number; level: number; tx: number; ty: number }

export type WebgpuTilePageTable = {
  readonly words: Uint32Array<ArrayBuffer>
  readonly entries: number
  readonly buffer: GPUBuffer
  /** Word of a streamed tile, as the shader will read it after `flush`. */
  entryOf(key: TileKey): number
  /** Feedback rank of a tile, and the inverse — both ends of the same list. */
  feedbackIndexOf(key: TileKey): number
  tileOf(feedbackIndex: number): TileKey
  /** The tail's place, and the tap every tile of the texture — this one included — is read by. */
  setTail(slot: number, place: TilePlace, tap: number): void
  setTile(key: TileKey, place: TilePlace): void
  /** Filter word, addressing and UV transform (`samplingWords`); true when a word moved. */
  setSampling(slot: number, texture: Texture): boolean
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
      header = PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS
    words[header] = layout.width | (layout.height << 16)
    words[header + 1] = layout.tail
    words[header + 2] = layout.last
    for (let level = 0; level < layout.tail; level++)
      words[levelsAt + slot * MAX_LEVELS + level] = entriesAt + bases[slot] + layout.offsets[level]
  }
  return { layouts, words, bases, entries, entriesAt, uploads: createPageUploads(words.length) }
}

/** The word of a streamed tile; a tile in the tail or off its level is refused. */
function wordIndex({ layouts, entriesAt, bases }: Table, { slot, level, tx, ty }: TileKey) {
  const layout = layouts[slot]
  if (level >= layout.tail) throw new Error('TEXTURE_TILE_IN_TAIL')
  const [tw, th] = tilesAt(layout.width, layout.height, level)
  if (tx >= tw || ty >= th) throw new Error('TEXTURE_TILE_OUT_OF_LEVEL')
  return entriesAt + bases[slot] + layout.offsets[level] + ty * tw + tx
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

/** The tile of entry `entry`: its texture by the entries' bases, then its level and place. */
function tileAt({ layouts, bases }: Table, entry: number): TileKey {
  let lo = 0,
    hi = layouts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bases[mid] <= entry) lo = mid
    else hi = mid - 1
  }
  const layout = layouts[lo],
    local = entry - bases[lo]
  let level = layout.tail - 1
  while (level > 0 && layout.offsets[level] > local) level--
  const [tw] = tilesAt(layout.width, layout.height, level),
    rank = local - layout.offsets[level]
  return { slot: lo, level, tx: rank % tw, ty: Math.floor(rank / tw) }
}

/** Filter word, addressing and UV transform of texture `slot`; true when a word moved. */
function setSampling(table: Table, slot: number, texture: Texture) {
  const at = PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS,
    sampling = samplingWords(texture)
  let moved = write(table, at + 2, table.layouts[slot].last | (sampling[0] << PAGE_FILTER_SHIFT))
  for (let i = 1; i <= TRANSFORM_WORDS; i++)
    moved = write(table, at + PAGE_TRANSFORM_WORD - 1 + i, sampling[i]) || moved
  return moved
}

function setTile(table: Table, key: TileKey, place: TilePlace) {
  const word = packEntry(place, key.level)
  write(table, wordIndex(table, key), word)
  // Downward: every finer entry served by a coarser ancestor, or by nothing, is better served
  // by this one; one served by this very tile at its former place — an atlas resize moves a
  // resident tile (`atlasResize.ts`) — follows it to the new one.
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
      [tw, th] = tilesAt(layout.width, layout.height, level)
    const [tx, ty] = [key.tx >> shift, key.ty >> shift]
    if (tx >= tw || ty >= th) continue
    const word = table.words[wordIndex(table, { slot: key.slot, level, tx, ty })]
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
  options: { kind: 'color' | 'data'; feedbackOffset: number },
): WebgpuTilePageTable {
  const table = pageTable(layouts, options.feedbackOffset),
    { words, entries, entriesAt } = table
  const buffer = device.createBuffer({
    label: `Trillion3D texture pages ${options.kind}`,
    size: Math.max(16, words.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, words)
  return {
    words,
    entries,
    buffer,
    entryOf: (key) => words[wordIndex(table, key)],
    feedbackIndexOf: (key) => wordIndex(table, key) - entriesAt + options.feedbackOffset,
    tileOf(feedbackIndex) {
      const entry = feedbackIndex - options.feedbackOffset
      if (entry < 0 || entry >= entries) throw new Error('TEXTURE_FEEDBACK_INDEX')
      return tileAt(table, entry)
    },
    setTail(slot, place, tap) {
      const header = PAGE_HEADER_WORDS + slot * PAGE_SLOT_WORDS
      write(table, header + 3, packPlace(place) | (tap << 24))
    },
    setSampling: (slot, texture) => setSampling(table, slot, texture),
    setTile: (key, place) => setTile(table, key, place),
    clearTile: (key) => clearTile(table, key),
    flush: (target) => table.uploads.flush(target.queue, buffer, words),
    destroy() {
      buffer.destroy()
    },
  }
}
