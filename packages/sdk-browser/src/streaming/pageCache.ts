import { MIB } from '../../../math/src/constants.ts'
import { createRangedReads } from '../cluster/ranged.ts'
import { createCacheEntries } from './cacheEntries.ts'
import { closeTextureLevel, textureLevelBytes, type TextureLevel } from '../texture/levelReader.ts'

/** The CPU total by default. Streaming bundles are far larger than a single cluster page, so a
 *  cache bounded only by entry count would hold hundreds of megabytes. */
export const DEFAULT_CACHED_BYTES = 256 * MIB

/** A session reading through the cache: the most pages it lets the cache hold, and who hears a page
 *  evicted, or an eviction that found nothing it could take. What it reserves off the total it
 *  tells the seat it opens (`open`) each time that changes. */
export type CacheSession = {
  maxPages?: number
  evicted?(url: string): void
  blocked?(): void
}

/** What an entry of the cache holds: a page, with the fingerprint its bytes were verified against
 *  when read; a file a server answered whole in place of a range (`createRangedReads`); a decoded
 *  texture level or a block tile's record (`texture/heldLevels.ts`); or the read of the scene's
 *  proxy, with the cancellation that is the cache's, not a session's. */
type Held =
  | { kind: 'page'; array: Uint8Array; sha256: string | undefined }
  | { kind: 'file'; buffer: ArrayBuffer }
  | { kind: 'level'; level: TextureLevel }
  | KeptRead
type KeptRead = { kind: 'proxy'; read: Promise<ArrayBuffer>; abort: AbortController }

/** The tier of the scene's proxy: it leaves only once no page, file or level that may leave is left
 *  (`cacheEntries.ts`). Every other entry is of tier 0, by last use alone. */
const SCENE_TIER = 1
/** The lane of the pages (`cacheEntries.ts`): the page bound takes them alone, every other entry
 *  in lane 0. */
const PAGE_LANE = 1

const checkBytes = (bytes: number) => {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error('INVALID_PAGE_CACHE_BUDGET')
}

/**
 * THE ONE HOST CACHE: the bytes of every page and bundle read, of every file a server answered
 * whole in place of a range (`readRange`), of every decoded texture level and block tile record
 * (`level`), and of the scene's resident proxy (`keep`), as one set of entries, ONE budget and ONE
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
 * used, the proxy last; past the fewest pages a session allows, the pages alone. A level needs no
 * room of its own: it takes what eviction can free (`roomBytes`), as a page does.
 */
export function createPageCache(cpuBytes = DEFAULT_CACHED_BYTES) {
  checkBytes(cpuBytes)
  const sessions = new Set<CacheSession>()
  let total = cpuBytes,
    /** Bytes the sessions reserve off the total, their sum kept as each tells its own. */
    reserved = 0,
    pages = 0,
    levelBytes = 0,
    /** The key the scene's proxy is kept under, while one is. */
    proxy: string | undefined
  const entries = createCacheEntries<Held>(
    (held, key) => {
      if (held.kind === 'page') pages--
      else if (held.kind === 'level') {
        levelBytes -= textureLevelBytes(held.level)
        closeTextureLevel(held.level)
      } else if (held.kind === 'proxy') {
        held.abort.abort(new DOMException('Kept file released', 'AbortError'))
        if (proxy === key) proxy = undefined
      }
    },
    (held) => (held.kind === 'page' ? PAGE_LANE : 0),
  )
  /** The fewest pages a session lets the cache hold; none bounds them by default. */
  const pageBound = () => {
    let most = Infinity
    for (const { maxPages } of sessions)
      if (maxPages && maxPages >= 1) most = Math.min(most, maxPages)
    return most
  }
  /** Each page that leaves is told to every session. */
  const told = (key: string, held: Held) => {
    if (held.kind === 'page') for (const session of sessions) session.evicted?.(key)
  }
  /** Evicts what no one holds, the lowest tier and the least recently used first: the pages alone
   *  while they exceed their bound — no other entry lowers their count —, then any entry while the
   *  entries exceed the budget — read once: the entries leaving do not move it. An eviction that
   *  takes nothing while over is told every session. */
  const fit = () => {
    const budget = cache.budgetBytes,
      most = pageBound()
    const over = () => entries.bytes > budget || pages > most
    if (!over()) return
    const count =
      entries.evict(() => pages > most, told, PAGE_LANE) +
      entries.evict(() => entries.bytes > budget, told)
    if (!count && over()) for (const session of sessions) session.blocked?.()
  }
  const cache = {
    /** Bytes every entry holds. */
    get bytes() {
      return entries.bytes
    },
    /** Bytes of the entries someone holds: no eviction takes them. */
    get heldBytes() {
      return entries.heldBytes
    },
    /** How many pages it holds. */
    get pageCount() {
      return pages
    },
    /** Bytes the texture levels and tile records hold. */
    get levelBytes() {
      return levelBytes
    },
    /** The CPU total: entries, manifest tables, transfer queues and engine tables together. */
    get cpuBytes() {
      return total
    },
    /** Bytes the sessions reading through it reserve off the total. */
    get reservedBytes() {
      return reserved
    },
    /** Bytes the entries may hold: the total less what is reserved (`reservedBytes`). */
    get budgetBytes() {
      return Math.max(0, total - cache.reservedBytes)
    },
    /** Bytes an entry landing may take: the budget, less what no eviction may take. */
    get roomBytes() {
      return Math.max(0, cache.budgetBytes - entries.heldBytes)
    },
    /** Bytes the entry at `key` holds; 0 for none. */
    weight: (key: string) => entries.entry(key)?.bytes ?? 0,
    /** The entry at `key` now weighs `bytes` — the decoded allocations of a read kept —, while the
     *  cache keeps it. */
    weigh(key: string, bytes: number) {
      entries.resize(key, bytes)
      fit()
    },
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
      pages++
    },
    /** The entry at `url` leaves, its holds with it. */
    drop: entries.drop,
    /** Whether the page held at `url` is another file than the one `announced` names: another
     *  fingerprint or another size, or bytes never verified against one. A name alone is not a
     *  file: another scene, another base or the same folder cooked again may reuse it at the same
     *  size. The same fingerprint is the same bytes, verified at read, under any base. */
    foreign({ url, bytes, sha256 }: { url: string; bytes: number; sha256?: string }) {
      const held = entries.entry(url)?.value
      return held?.kind === 'page' && (held.sha256 !== sha256 || held.array.byteLength !== bytes)
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
      if (buffer.byteLength > cache.roomBytes) return
      entries.set(url, { kind: 'file', buffer }, buffer.byteLength)
      fit()
    },
    /** The texture level or tile record held under `id`, marked used last. */
    level(id: string) {
      const held = entries.touch(id)
      return held?.kind === 'level' ? held.level : undefined
    },
    /** Holds `level` under `id`, the cache owning it from here: it closes it as it leaves. A level
     *  already held — read meanwhile by the session a device loss replaced — stays, marked used
     *  last, and the copy closes: its bytes are counted once. */
    keepLevel(id: string, level: TextureLevel) {
      if (cache.level(id)) return closeTextureLevel(level)
      const bytes = textureLevelBytes(level)
      entries.set(id, { kind: 'level', level }, bytes)
      levelBytes += bytes
      fit()
    },
    /**
     * The read of the file `key` names, of `bytes` bytes — the scene's resident proxy —, kept
     * whole in place of any other: `start` begins it on the cache's own cancellation when it is not
     * kept, and a session reopened meanwhile joins the one in flight. Its bytes count from the
     * moment it is asked; held while in flight, it leaves only once landed, and then only once no
     * page, file or level may (`SCENE_TIER`). It stays across sessions until `keepOnly` no longer
     * names it. A read that fails leaves at once.
     */
    keep(key: string, bytes: number, start: (signal: AbortSignal) => Promise<ArrayBuffer>) {
      const held = entries.touch(key)
      if (held?.kind === 'proxy') return held.read
      cache.keepOnly(key)
      const abort = new AbortController()
      const own: KeptRead = { kind: 'proxy', read: start(abort.signal), abort }
      proxy = key
      entries.acquire(key)
      entries.set(key, own, bytes, SCENE_TIER)
      const kept = () => entries.entry(key)?.value === own
      own.read.then(
        () => {
          if (!kept()) return
          entries.release(key)
          fit()
        },
        () => kept() && entries.drop(key),
      )
      fit()
      return own.read
    },
    /** Lets the scene's proxy go, its read cancelled, unless `key` names it: a scene gone. */
    keepOnly(key?: string) {
      if (proxy !== undefined && proxy !== key) entries.drop(proxy)
    },
    /** Sets the total, and evicts at once what no longer fits. */
    resize(cpu: number) {
      checkBytes(cpu)
      total = cpu
      fit()
    },
    /** `session` reads through the cache from now on, `reserving` bytes off the total, until it
     *  leaves: the seat it is handed tells each new reserve (`reserve`) and its leave (`leave`). */
    open(session: CacheSession, reserving: number) {
      sessions.add(session)
      let own = 0
      const seat = {
        /** The session reserves `bytes` from now on: what no longer fits leaves. */
        reserve(bytes: number) {
          reserved += bytes - own
          own = bytes
          fit()
        },
        /** The session reads through the cache no more: its reserve is given back. */
        leave() {
          if (!sessions.delete(session)) return
          reserved -= own
          own = 0
        },
      }
      seat.reserve(reserving)
      return seat
    },
    /** Empties the cache: its owner is gone. */
    clear() {
      entries.clear()
      pages = levelBytes = 0
      proxy = undefined
    },
  }
  /** Bytes `[offset, offset + length)` of the file at `url`, by an HTTP Range, for every load and
   *  session that reads through this cache: a file its server answers whole is read once and kept
   *  here (`createRangedReads`). */
  return Object.assign(cache, { readRange: createRangedReads(cache) })
}

/** The decoded-page cache a session reads through (`createPageCache`). */
export type PageCache = ReturnType<typeof createPageCache>
