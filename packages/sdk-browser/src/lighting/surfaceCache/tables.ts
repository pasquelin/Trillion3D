import { nextPow2 } from '../../../../math/src/scalar/integers.ts'
import { PAGE_SIZE } from '../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import {
  CARD_WORDS,
  MESH_CARDS_WORDS,
  writeCardWords,
  writeMeshCardsWords,
  type CardWords,
} from '../../../../sdk-core/src/lighting/surfaceCache/cardRecords.ts'
import {
  CARD_PAGE_WORDS,
  PAGE_TABLE_WORDS,
  writeCardPageWords,
  writePageTableWords,
} from '../../../../sdk-core/src/lighting/surfaceCache/pageRecords.ts'
import type {
  IndexList,
  SurfaceCache,
} from '../../../../sdk-core/src/lighting/surfaceCache/state.ts'
import { resized } from '../../../../math/src/sequence/resized.ts'
import { retire } from '../../gpu/core/frameRetire.ts'
import { NO_MESH_CARDS, TABLE_AT, TABLE_HEADER_WORDS } from './layout.ts'

/**
 * THE TABLES A READ OF THE SURFACE CACHE WALKS, in one storage buffer of words (`sampleWgsl.ts`): a
 * header, then the sections — the mesh cards, the cards, the page table, the pages' records, the
 * table from a placement to its mesh cards — each as many records as its capacity, the header saying
 * where each begins (`TABLE_AT`). The CPU's cache (`SurfaceCache`) is the truth: what its passes
 * changed since the last image, listed in `cache.changes`, is written here — a record at a time,
 * the runs of neighbours in one copy —, and the buffer is made again, larger, when a section's
 * capacity is passed: then every record is written. The records' layouts are the cache's own
 * (`cardRecords.ts`, `pageRecords.ts`).
 *
 * The records go up as a step of the image's commands, not before them: they are written to an upload
 * buffer, and each run copied from it into the tables on the image's encoder (`SurfaceTables.update`).
 * What the image encoded before reads the tables as they were — the capture's resample reads the cards it
 * captures again so (`copy.ts`) —; what it encodes after reads them as they are. The upload buffer holds
 * every update of an image, one after the other: all of them are written before the image's commands run.
 */

/** The records a section holds at least. */
const LEAST = { meshCards: 32, cards: 64, pages: 256, placements: 64 } as const

/** The capacity of each section, in records. */
interface Capacity {
  meshCards: number
  cards: number
  pages: number
  placements: number
}

/** Where each section begins, in words, and how many the buffer holds, for `capacity`. */
function layoutOf(capacity: Capacity) {
  const meshCardsAt = TABLE_HEADER_WORDS
  const cardsAt = meshCardsAt + capacity.meshCards * MESH_CARDS_WORDS
  const pageTableAt = cardsAt + capacity.cards * CARD_WORDS
  const cardPagesAt = pageTableAt + capacity.pages * PAGE_TABLE_WORDS
  const placementsAt = cardPagesAt + capacity.pages * CARD_PAGE_WORDS
  return {
    meshCardsAt,
    cardsAt,
    pageTableAt,
    cardPagesAt,
    placementsAt,
    words: placementsAt + capacity.placements,
  }
}

/** The capacity the cache's ranges ask: each a power of two over what is in use, never under
 *  `LEAST`, and never less than `held` where that holds already. */
function capacityFor(
  cache: SurfaceCache,
  placements: number,
  held: Capacity | undefined,
): Capacity {
  const wanted = (least: number, used: number, kept?: number) =>
    Math.max(least, kept ?? 0, nextPow2(Math.max(1, used)))
  return {
    meshCards: wanted(LEAST.meshCards, cache.meshCards.length, held?.meshCards),
    cards: wanted(LEAST.cards, cache.cards.length, held?.cards),
    pages: wanted(LEAST.pages, cache.pages.length, held?.pages),
    placements: wanted(LEAST.placements, placements, held?.placements),
  }
}

/** Whether two capacities are the same. */
const sameCapacity = (a: Capacity, b: Capacity) =>
  a.meshCards === b.meshCards &&
  a.cards === b.cards &&
  a.pages === b.pages &&
  a.placements === b.placements

/** One past the largest index of `list`. */
function endOf(list: IndexList) {
  let end = 0
  for (let at = 0; at < list.count; at++) end = Math.max(end, list.list[at] + 1)
  return end
}

/** What the tables write of one kind of record: the section it goes to, its words, and how it fills
 *  its words for the index it is told. */
interface Section {
  readonly at: number
  readonly words: number
  fill(scratch: CardWords, offset: number, index: number): void
}

/** No index. */
const NONE = new Int32Array(0)

/** The indices of `list`, ascending; the list is left as it was. */
const sortedOf = (list: IndexList) =>
  list.count ? Int32Array.from(list.list.subarray(0, list.count)).sort() : NONE

/** What an update sends up: its words, one run after the other, and for each run where it goes in the
 *  tables and how many words it is (`runs`: pairs). */
function createUpload() {
  let words: CardWords = { f32: new Float32Array(0), u32: new Uint32Array(0) }
  let used = 0
  const runs: number[] = []
  return {
    runs,
    get used() {
      return used
    },
    get words() {
      return words.u32
    },
    clear() {
      used = 0
      runs.length = 0
    },
    /** The words of a run of `count` words that goes to word `to` of the tables, and where it starts in them. */
    add(to: number, count: number) {
      const u32 = resized(words.u32, used + count)
      if (u32 !== words.u32) words = { f32: new Float32Array(u32.buffer), u32 }
      runs.push(to, count)
      const at = used
      used += count
      return { words, at }
    },
  }
}

type Upload = ReturnType<typeof createUpload>

/** Adds the records `indices` of `section` to `upload`: each run of consecutive indices one run. */
function writeRuns(upload: Upload, section: Section, indices: ArrayLike<number>) {
  let from = 0
  while (from < indices.length) {
    let to = from + 1
    while (to < indices.length && indices[to] === indices[to - 1] + 1) to++
    const count = to - from
    const { words, at } = upload.add(
      section.at + indices[from] * section.words,
      count * section.words,
    )
    for (let k = 0; k < count; k++) section.fill(words, at + k * section.words, indices[from + k])
    from = to
  }
}

/** The indices of a span array that hold an element: what a buffer made again is written with. */
const allocatedOf = (array: { readonly length: number; has(index: number): boolean }) => {
  const held: number[] = []
  for (let at = 0; at < array.length; at++) if (array.has(at)) held.push(at)
  return held
}

/** What the sections are written from: where each begins, the cache and the atlas's side, set by each update. */
interface TableSource {
  where: ReturnType<typeof layoutOf>
  cache: SurfaceCache
  side: number
}

/** The sections of the tables, each read from `source`. */
function sectionsOf(source: TableSource) {
  return {
    meshCards: {
      get at() {
        return source.where.meshCardsAt
      },
      words: MESH_CARDS_WORDS,
      fill: (w: CardWords, at: number, index: number) => {
        const { meshCards } = source.cache
        writeMeshCardsWords(w, at, meshCards.has(index) ? meshCards.at(index) : undefined)
      },
    },
    cards: {
      get at() {
        return source.where.cardsAt
      },
      words: CARD_WORDS,
      fill: (w: CardWords, at: number, index: number) => {
        const { cards } = source.cache
        writeCardWords(w, at, cards.has(index) ? cards.at(index) : undefined)
      },
    },
    pageTable: {
      get at() {
        return source.where.pageTableAt
      },
      words: PAGE_TABLE_WORDS,
      fill: (w: CardWords, at: number, index: number) => {
        const { pages } = source.cache
        writePageTableWords(w.u32, at, pages.has(index) ? pages.at(index) : undefined)
      },
    },
    cardPages: {
      get at() {
        return source.where.cardPagesAt
      },
      words: CARD_PAGE_WORDS,
      fill: (w: CardWords, at: number, index: number) => {
        const { pages, cards } = source.cache
        const page = pages.has(index) ? pages.at(index) : undefined
        const card = page && cards.has(page.card) ? cards.at(page.card) : undefined
        writeCardPageWords(w, at, page, card, source.side)
      },
    },
    placements: {
      get at() {
        return source.where.placementsAt
      },
      words: 1,
      fill: (w: CardWords, at: number, index: number) => {
        const meshCards = source.cache.placements.get(index)?.meshCards ?? -1
        w.u32[at] = meshCards >= 0 ? meshCards : NO_MESH_CARDS
      },
    },
  } satisfies Record<string, Section>
}

type TableSections = ReturnType<typeof sectionsOf>

/** Writes every record of the cache: what a buffer made again holds. A placement with no mesh cards
 *  reads as none, so every number of the table is written. */
function writeAll(
  upload: Upload,
  sections: TableSections,
  cache: SurfaceCache,
  placements: number,
) {
  writeRuns(upload, sections.meshCards, allocatedOf(cache.meshCards))
  writeRuns(upload, sections.cards, allocatedOf(cache.cards))
  const held = allocatedOf(cache.pages)
  writeRuns(upload, sections.pageTable, held)
  writeRuns(upload, sections.cardPages, held)
  const ids = Array.from({ length: placements }, (_, id) => id)
  writeRuns(upload, sections.placements, ids)
}

/** Writes the records the cache's passes changed since the last image. */
function writeChanges(upload: Upload, sections: TableSections, { changes }: SurfaceCache) {
  writeRuns(upload, sections.meshCards, sortedOf(changes.meshCards))
  writeRuns(upload, sections.cards, sortedOf(changes.cards))
  const pages = sortedOf(changes.pages)
  writeRuns(upload, sections.pageTable, pages)
  writeRuns(upload, sections.cardPages, pages)
  writeRuns(upload, sections.placements, sortedOf(changes.placements))
}

/** Writes the table's header into `header`. */
function writeHeader(
  header: Uint32Array,
  headerFloats: Float32Array,
  source: TableSource,
  placements: number,
  preExposure: number,
  colorBoost: number,
) {
  const { cache, where } = source
  header[TABLE_AT.cards] = cache.cards.length
  header[TABLE_AT.meshCards] = cache.meshCards.length
  header[TABLE_AT.pages] = cache.pages.length
  header[TABLE_AT.placements] = placements
  header[TABLE_AT.atlasSide] = source.side
  headerFloats[TABLE_AT.invAtlasSide] = source.side > 0 ? 1 / source.side : 0
  header[TABLE_AT.meshCardsAt] = where.meshCardsAt
  header[TABLE_AT.cardsAt] = where.cardsAt
  header[TABLE_AT.pageTableAt] = where.pageTableAt
  header[TABLE_AT.cardPagesAt] = where.cardPagesAt
  header[TABLE_AT.placementsAt] = where.placementsAt
  header[TABLE_AT.frame] = cache.frame
  headerFloats[TABLE_AT.invPreExposure] = 1 / preExposure
  headerFloats[TABLE_AT.colorBoost] = colorBoost
}

/** What the tables keep between two images. */
interface TableState {
  readonly device: GPUDevice
  readonly upload: Upload
  /** The header of this update, and the one the tables hold: sent only when they differ. */
  readonly header: Uint32Array<ArrayBuffer>
  readonly headerFloats: Float32Array
  readonly sentHeader: Uint32Array
  readonly source: TableSource
  readonly sections: TableSections
  buffer: GPUBuffer | undefined
  capacity: Capacity | undefined
  generation: number
}

/** Sends what `upload` holds into the tables: the words in an upload buffer of their own, each run copied
 *  from it on `encoder`; the upload buffer is retired, freed once the image is submitted. */
function sendUpload(state: TableState, encoder: GPUCommandEncoder) {
  const { upload, device } = state
  const staging = device.createBuffer({
    label: 'Trillion3D surface cache tables upload',
    size: upload.used * 4,
    usage: GPUBufferUsage.COPY_SRC,
    mappedAtCreation: true,
  })
  new Uint32Array(staging.getMappedRange()).set(upload.words.subarray(0, upload.used))
  staging.unmap()
  const { runs } = upload
  for (let k = 0, from = 0; k < runs.length; k += 2) {
    encoder.copyBufferToBuffer(staging, from * 4, state.buffer!, runs[k]! * 4, runs[k + 1]! * 4)
    from += runs[k + 1]!
  }
  retire(device, staging)
  upload.clear()
}

/** Brings the buffer level with `cache` on `encoder` (`SurfaceTables.update`). */
function updateTables(
  state: TableState,
  cache: SurfaceCache,
  preExposure: number,
  colorBoost: number,
  encoder: GPUCommandEncoder,
): boolean {
  const { device, upload, source, sections } = state
  const { changes } = cache
  const wanted = capacityFor(cache, endOf(changes.placements), state.capacity)
  const grown = !state.buffer || !state.capacity || !sameCapacity(wanted, state.capacity)
  if (grown) {
    if (state.buffer) retire(device, state.buffer)
    source.where = layoutOf(wanted)
    state.buffer = device.createBuffer({
      label: 'Trillion3D surface cache tables',
      size: source.where.words * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    state.capacity = wanted
    state.generation++
  }
  source.cache = cache
  source.side = cache.atlasPages * PAGE_SIZE
  const placements = state.capacity!.placements
  if (grown) writeAll(upload, sections, cache, placements)
  else writeChanges(upload, sections, cache)
  changes.cards.clear()
  changes.meshCards.clear()
  changes.pages.clear()
  changes.placements.clear()
  const { header, headerFloats, sentHeader } = state
  writeHeader(header, headerFloats, source, placements, preExposure, colorBoost)
  if (grown || header.some((word, at) => word !== sentHeader[at])) {
    const { words, at } = upload.add(0, TABLE_HEADER_WORDS)
    words.u32.set(header, at)
    sentHeader.set(header)
  }
  if (upload.used) sendUpload(state, encoder)
  return grown
}

/** The tables of a surface cache on the GPU. */
export function createSurfaceTables(device: GPUDevice) {
  /** What the records are written from. */
  const source: TableSource = {
    where: layoutOf({ meshCards: 0, cards: 0, pages: 0, placements: 0 }),
    cache: undefined as unknown as SurfaceCache,
    side: 0,
  }
  const header = new Uint32Array(TABLE_HEADER_WORDS)
  const state: TableState = {
    device,
    upload: createUpload(),
    header,
    headerFloats: new Float32Array(header.buffer),
    sentHeader: new Uint32Array(TABLE_HEADER_WORDS),
    source,
    sections: sectionsOf(source),
    buffer: undefined,
    capacity: undefined,
    generation: 0,
  }

  return {
    /** The buffer the reads bind, none before the first `update`. */
    get buffer() {
      return state.buffer
    },
    /** How many times the buffer was made: a bind group made over it is made again when it moves. */
    get generation() {
      return state.generation
    },
    /** The bytes held. */
    get bytes() {
      return state.buffer?.size ?? 0
    },
    /**
     * Brings the buffer level with `cache`, as a step of `encoder`: the records its passes changed are
     * copied in and its header, the buffer made again where a section's capacity is passed — the one it
     * replaces holds the tables as they were until the image is submitted. The table from a placement's
     * number to its mesh cards' index is the cache's own (`SurfaceCache.placements`); `preExposure` is the
     * number the light is kept multiplied by, `colorBoost` the boost of the diffuse colour. True when the
     * buffer is another.
     */
    update: (
      cache: SurfaceCache,
      preExposure: number,
      colorBoost: number,
      encoder: GPUCommandEncoder,
    ): boolean => updateTables(state, cache, preExposure, colorBoost, encoder),
    dispose() {
      state.buffer?.destroy()
      state.buffer = undefined
      source.cache = undefined as unknown as SurfaceCache
    },
  }
}

/** The tables of a surface cache (`createSurfaceTables`). */
export type SurfaceTables = ReturnType<typeof createSurfaceTables>
