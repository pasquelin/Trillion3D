import { MIB } from '../../../../math/src/constants.ts'
import { createRangedReads } from '../cluster/ranged.ts'
import { createCacheEntries } from './cacheEntries.ts'
import { joinMembers } from '../members.ts'
import type { TextureLevel } from '../../materials/texture/levelReader.ts'

/** The CPU total by default. Streaming bundles are far larger than a single cluster page, so a
 *  cache bounded only by entry count would hold hundreds of megabytes. */
export const DEFAULT_CACHED_BYTES = 256 * MIB

/** A session reading through the cache: who hears a page evicted, or an eviction that found
 *  nothing it could take. What it reserves off the total it
 *  tells the seat it opens (`open`) each time that changes. */
export type CacheSession = {
  /** Called with a page's url as the cache evicts it. */
  evicted?(url: string): void
  /** Called when an eviction over budget found nothing it could take. */
  blocked?(): void
}

/** What an entry of the cache holds: a page, with the fingerprint its bytes were verified against
 *  when read; a file a server answered whole in place of a range (`createRangedReads`); a decoded
 *  texture level or a block tile's record (`materials/texture/heldLevels.ts`). */
type Held =
  | { kind: 'page'; array: Uint8Array; sha256: string | undefined }
  | { kind: 'file'; buffer: ArrayBuffer }
  | { kind: 'level'; level: TextureLevel }

const checkBytes = (bytes: number) => {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error('INVALID_PAGE_CACHE_BUDGET')
}

/** What the cache keeps: its entries and the totals the entries and the sessions move. */
interface CacheState {
  sessions: Set<CacheSession>
  total: number
  /** Bytes the sessions reserve off the total, their sum kept as each tells its own. */
  reserved: number
  pages: number
  levelBytes: number
  entries: ReturnType<typeof createCacheEntries<Held>>
  /** Each page that leaves is told to every session. */
  told(key: string, held: Held): void
}

/** An entry left the cache: its count. */
function leaves(c: CacheState, held: Held) {
  if (held.kind === 'page') c.pages--
  else if (held.kind === 'level') c.levelBytes -= held.level.byteLength
}

/** The totals the cache reports: what it holds, what it may hold, what it can take. */
function cacheTotals(c: CacheState) {
  const totals = {
    /** Bytes every entry holds. */
    get bytes() {
      return c.entries.bytes
    },
    /** Bytes of the entries someone holds: no eviction takes them. */
    get heldBytes() {
      return c.entries.heldBytes
    },
    /** How many pages it holds. */
    get pageCount() {
      return c.pages
    },
    /** Bytes the texture levels and tile records hold. */
    get levelBytes() {
      return c.levelBytes
    },
    /** The CPU total: entries, manifest tables, transfer queues and engine tables together. */
    get cpuBytes() {
      return c.total
    },
    /** Bytes the sessions reading through it reserve off the total. */
    get reservedBytes() {
      return c.reserved
    },
    /** Bytes the entries may hold: the total less what is reserved (`reservedBytes`). */
    get budgetBytes() {
      return Math.max(0, c.total - totals.reservedBytes)
    },
    /** Bytes an entry landing may take: the budget, less what no eviction may take. */
    get roomBytes() {
      return Math.max(0, totals.budgetBytes - c.entries.heldBytes)
    },
  }
  return totals
}

type CacheTotals = ReturnType<typeof cacheTotals>

/** Evicts what no one holds, the least recently used first, while the
 *  entries exceed the budget — read once: the entries leaving do not move it. An eviction that
 *  takes nothing while over is told every session. */
function evictToFit(c: CacheState, totals: CacheTotals) {
  const budget = totals.budgetBytes
  if (c.entries.bytes <= budget) return
  if (!c.entries.evict(() => c.entries.bytes > budget, c.told))
    for (const session of c.sessions) session.blocked?.()
}

/** The pages, files and levels the cache holds, and the weights they take. */
function cacheItems(c: CacheState, totals: CacheTotals, fit: () => void) {
  const { entries } = c
  return {
    /** The page at `url`, nothing marked. */
    page(url: string) {
      const held = entries.entry(url)?.value
      return held?.kind === 'page' ? held.array : undefined
    },
    /** The page at `url`, marked used last. */
    touch(url: string) {
      const held = entries.touch(url)
      return held?.kind === 'page' ? held.array : undefined
    },
    /** Puts `array` as the most recently used page at `url`; `sha256` when it was just read and
     *  verified. Its holds stay: a page pinned or in flight lands held. */
    put(url: string, array: Uint8Array, sha256?: string) {
      entries.set(url, { kind: 'page', array, sha256 }, array.byteLength)
      c.pages++
    },
    /** The entry at `url` leaves, its holds with it. */
    drop: entries.drop,
    /** Whether the page held at `url` is another file than the one `announced` names: another
     *  fingerprint or another size, or bytes never verified against one. A name alone is not a
     *  file: another scene, another base or the same folder cooked again may reuse it at the same
     *  size. The same fingerprint is the same bytes, verified at read, under any base. The size is
     *  the held bytes': a compressed bundle's, once inflated. */
    foreign({
      url,
      bytes,
      decodedBytes,
      sha256,
    }: {
      url: string
      bytes: number
      decodedBytes?: number
      sha256?: string
    }) {
      const held = entries.entry(url)?.value
      return (
        held?.kind === 'page' &&
        (held.sha256 !== sha256 || held.array.byteLength !== (decodedBytes ?? bytes))
      )
    },
    /** One more holds the entry at `url`, before it lands too. */
    acquire: entries.acquire,
    /** One hold on the entry at `url` ends; the caller weighs the cache when it is done (`fit`). */
    release: entries.release,
    /** Evicts what no longer fits (`fit`): after a page landed or a hold ended. */
    fit,
    /** The file at `url` a server answered whole, marked used last, while the cache keeps it. */
    file(url: string) {
      const held = entries.touch(url)
      return held?.kind === 'file' ? held.buffer : undefined
    },
    /** Keeps the file at `url` a server answered whole as the most recently used entry, when it
     *  fits in what eviction can free (`roomBytes`): one past it would take every entry, then
     *  itself, and is let go. */
    keepFile(url: string, buffer: ArrayBuffer) {
      if (buffer.byteLength > totals.roomBytes) return
      entries.set(url, { kind: 'file', buffer }, buffer.byteLength)
      fit()
    },
  }
}

/** The weights of the entries and the texture levels the cache keeps. */
function cacheLevels(c: CacheState, fit: () => void) {
  const { entries } = c
  const items = {
    /** Bytes the entry at `key` holds; 0 for none. */
    weight: (key: string) => entries.entry(key)?.bytes ?? 0,
    /** The entry at `key` now weighs `bytes` — the decoded allocations of a read kept —, while the
     *  cache keeps it. */
    weigh(key: string, bytes: number) {
      entries.resize(key, bytes)
      fit()
    },
    /** The texture level or tile record held under `id`, marked used last. */
    level(id: string) {
      const held = entries.touch(id)
      return held?.kind === 'level' ? held.level : undefined
    },
    /** Holds `level` under `id`, the cache owning it from here. A level already held — read
     *  meanwhile by the session a device loss replaced — stays, marked used last, and the copy is
     *  dropped: its bytes are counted once. */
    keepLevel(id: string, level: TextureLevel) {
      if (items.level(id)) return
      const bytes = level.byteLength
      entries.set(id, { kind: 'level', level }, bytes)
      c.levelBytes += bytes
      fit()
    },
  }
  return items
}

/** `session` reads through the cache from now on, `reserving` bytes off the total, until it
 *  leaves: the seat it is handed tells each new reserve (`reserve`) and its leave (`leave`). */
function openSeat(c: CacheState, fit: () => void, session: CacheSession, reserving: number) {
  c.sessions.add(session)
  let own = 0
  const seat = {
    /** The session reserves `bytes` from now on: what no longer fits leaves. */
    reserve(bytes: number) {
      c.reserved += bytes - own
      own = bytes
      fit()
    },
    /** The session reads through the cache no more: its reserve is given back. */
    leave() {
      if (!c.sessions.delete(session)) return
      c.reserved -= own
      own = 0
    },
  }
  seat.reserve(reserving)
  return seat
}

/** The total, the sessions and the emptying. */
function cacheKeeps(c: CacheState, fit: () => void) {
  return {
    /** Sets the total, and evicts at once what no longer fits. */
    resize(cpu: number) {
      checkBytes(cpu)
      c.total = cpu
      fit()
    },
    open: (session: CacheSession, reserving: number) => openSeat(c, fit, session, reserving),
    /** Empties the cache: its owner is gone. */
    clear() {
      c.entries.clear()
      c.pages = c.levelBytes = 0
    },
  }
}

/**
 * THE ONE HOST CACHE: the bytes of every page and bundle read, of every file a server answered
 * whole in place of a range (`readRange`), of every texture tile record, as blocks or decoded
 * (`level`), as one set of entries, ONE budget and ONE
 * eviction (`cacheEntries.ts`), against the CPU total (`cpuBytes`, `world.budget.cpu`). Its owner
 * keeps it across sessions: a world hands the same one to every session it opens, so a session
 * reopened — on a device granted again after a loss, or on a scene that changed — reads what the
 * last one fetched from here, and fetches nothing it holds.
 *
 * Each session reading through it reserves its manifest tables, its transfer queue and the
 * engine's tables (`manifestTableBytes`, `maxTransferBytes`, the streamer's `reserve`), told as
 * they change (`open`), the cache keeping their sum, and takes holds on the pages it pins or
 * reads; the entries hold the rest (`budgetBytes`). The cache alone evicts, once its entries
 * exceed the budget: an entry someone holds never, then the pages, files and levels least recently
 * used. A level needs no
 * room of its own: it takes what eviction can free (`roomBytes`), as a page does.
 */
export function createPageCache(cpuBytes = DEFAULT_CACHED_BYTES) {
  checkBytes(cpuBytes)
  const c: CacheState = {
    sessions: new Set<CacheSession>(),
    total: cpuBytes,
    reserved: 0,
    pages: 0,
    levelBytes: 0,
    entries: createCacheEntries<Held>((held) => leaves(c, held)),
    told: (key, held) => {
      if (held.kind === 'page') for (const session of c.sessions) session.evicted?.(key)
    },
  }
  const totals = cacheTotals(c)
  const fit = () => evictToFit(c, totals)
  const cache = joinMembers(
    totals,
    cacheItems(c, totals, fit),
    cacheLevels(c, fit),
    cacheKeeps(c, fit),
  )
  return Object.assign(cache, {
    /** Bytes `[offset, offset + length)` of the file at `url`, by an HTTP Range, for every load and
     *  session that reads through this cache: a file its server answers whole is read once and kept
     *  here (`createRangedReads`). */
    readRange: createRangedReads(cache),
  })
}

/** The decoded-page cache a session reads through (`createPageCache`). */
export type PageCache = ReturnType<typeof createPageCache>
