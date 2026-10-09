import { MIB } from '../../../math/src/constants.ts'
import { createRangedReads } from '../cluster/ranged.ts'
import { createCacheEntries } from './cacheEntries.ts'
import { createTextureLevelStore, textureLevelShare } from '../texture/levelStore.ts'

/** The CPU total by default. Streaming bundles are far larger than a single cluster page, so a
 *  cache bounded only by entry count would hold hundreds of megabytes. */
export const DEFAULT_CACHED_BYTES = 256 * MIB

/** The session reading through the cache: what it reserves off the total, which may change while
 *  it reads, and how it evicts — past what is held — when the pages do not fit. */
type Holder = { reserved(): number; evict(): void }

/** The read kept whole beside the pages, the scene's resident proxy: its key, its read, and the
 *  cancellation that is the cache's, not a session's. */
type Kept = { kind: 'kept'; key: string; read: Promise<ArrayBuffer>; abort: AbortController }

/** What an entry of the cache holds: a page, with the fingerprint its bytes were verified against
 *  when read; a file a server answered whole in place of a range (`createRangedReads`); or the
 *  kept read. */
type Held =
  | { kind: 'page'; array: Uint8Array; sha256: string | undefined }
  | { kind: 'file'; buffer: ArrayBuffer }
  | Kept

const checkBytes = (bytes: number) => {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error('INVALID_PAGE_CACHE_BUDGET')
}

/**
 * The decoded-page cache: the bytes of every page and bundle read, of every file a server answered
 * whole in place of a range (`readRange`), and of the scene's resident proxy (`keep`), as one set
 * of entries least recently used first (`cacheEntries.ts`), and the CPU total they count against
 * (`cpuBytes`, `world.budget.cpu`). One cache, which its owner keeps across sessions: a world hands
 * the same one to every session it opens, so a session reopened — on a device granted again after
 * a loss, or on a scene that changed — reads what the last one fetched from here, and fetches
 * nothing it holds.
 *
 * The total is shared by a fixed rule: the session reading through it reserves its manifest
 * tables, its transfer queue and the engine's tables (`manifestTableBytes`, `maxTransferBytes`, the
 * streamer's `reserve`), the decoded texture levels take theirs (`levels`, at most
 * `textureLevelShare` of the total, within what the entries held leave), and the entries hold the
 * rest (`budgetBytes`). An entry someone holds — a page the session pins or reads, the kept proxy —
 * is never evicted. Eviction runs only once the entries exceed the budget: through the session in
 * place, which first lets the levels and the kept proxy yield, or by last use alone when none
 * reads.
 */
export function createPageCache(cpuBytes = DEFAULT_CACHED_BYTES) {
  checkBytes(cpuBytes)
  let total = cpuBytes,
    holder: Holder | undefined,
    pages = 0,
    kept: Kept | undefined
  const entries = createCacheEntries<Held>((held) => {
    if (held.kind === 'page') pages--
    else if (held === kept) kept = undefined
  })
  /** The entries leave by last use until they fit, through the session in place. */
  const evict = () => {
    if (holder) holder.evict()
    else entries.evict(() => entries.bytes > cache.budgetBytes)
  }
  /** Evicts only once the entries exceed the budget. */
  const fit = () => {
    if (entries.bytes > cache.budgetBytes) evict()
  }
  // With no session reading — between a lost device and its next session — every entry is held
  // for the next one: a level landing then takes no page's place.
  const levels = createTextureLevelStore(textureLevelShare(cpuBytes), {
    roomBeside: () => cache.levelRoom(holder ? entries.heldBytes : entries.bytes),
    onHeld: fit,
  })
  const cache = {
    /** Bytes the entries hold: the pages, the files kept whole and the kept proxy. */
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
    /** The CPU total: entries, manifest tables, transfer queue and engine tables together. */
    get cpuBytes() {
      return total
    },
    /** Bytes reserved off the total: the session's in place, and the decoded texture levels'. */
    get reservedBytes() {
      return (holder?.reserved() ?? 0) + levels.bytes
    },
    /** Bytes the texture levels may take beside the `held` bytes no eviction may take; negative
     *  when those do not fit. */
    levelRoom: (held: number) => total - (holder?.reserved() ?? 0) - held,
    /** Bytes held beside the entries: the decoded texture levels'. */
    get besideBytes() {
      return levels.bytes
    },
    /** Bytes the entries may hold: the total less what is reserved (`reservedBytes`). */
    get budgetBytes() {
      return Math.max(0, total - cache.reservedBytes)
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
    /** One hold on the entry at `url` ends; the caller weighs the cache when it is done. */
    release: entries.release,
    /** Evicts the least recently used entries no one holds while `over()`, each page that leaves
     *  told to `evictedPage`. Returns how many left. */
    evict: (over: () => boolean, evictedPage: (url: string) => void) =>
      entries.evict(over, (url, held) => {
        if (held.kind === 'page') evictedPage(url)
      }),
    /** The file at `url` a server answered whole, marked used last, while the cache keeps it. */
    file(url: string) {
      const held = entries.touch(url)
      return held?.kind === 'file' ? held.buffer : undefined
    },
    /** Keeps the file at `url` a server answered whole as the most recently used entry. */
    keepFile(url: string, buffer: ArrayBuffer) {
      entries.set(url, { kind: 'file', buffer }, buffer.byteLength)
      fit()
    },
    /**
     * The read of the file `key` names, of `bytes` bytes — the scene's resident proxy —, kept
     * whole beside the pages in place of any other: `start` begins it on the cache's own
     * cancellation when none is kept, and a session reopened meanwhile joins the one in flight.
     * It is held from the moment it is asked, its bytes counted then: no page evicts it, and it
     * stays kept, across sessions, until `keepOnly` no longer names it, or it yields
     * (`yieldKept`). A read that fails leaves at once.
     */
    keep(key: string, bytes: number, start: (signal: AbortSignal) => Promise<ArrayBuffer>) {
      if (kept?.key === key) return kept.read
      cache.keepOnly(key)
      const abort = new AbortController()
      const own: Kept = { kind: 'kept', key, read: start(abort.signal), abort }
      kept = own
      entries.acquire(key)
      entries.set(key, own, bytes)
      own.read.catch(() => {
        if (kept === own) entries.drop(key)
      })
      fit()
      return own.read
    },
    /** Charge decoded allocations only while this file is still kept. */
    resizeKept(key: string, bytes: number) {
      if (kept?.key !== key || entries.entry(key)!.bytes === bytes) return
      entries.resize(key, bytes)
      fit()
    },
    /** The decoded texture levels, kept across sessions as the pages are (`levelStore.ts`); they
     *  yield first to the pages a frame keeps (`streaming/cache.ts`). */
    levels,
    /** Bytes the kept proxy holds. */
    get keptBytes() {
      return kept ? entries.entry(kept.key)!.bytes : 0
    },
    /** Lets the kept proxy go, its read cancelled, unless `key` names it: a scene gone. */
    keepOnly(key?: string) {
      if (!kept || kept.key === key) return
      kept.abort.abort(new DOMException('Kept file released', 'AbortError'))
      entries.drop(kept.key)
    },
    /** Gives the kept proxy's bytes back to the pages, its read left to whoever waits for it: the
     *  pages a frame keeps come first (`streaming/cache.ts`). */
    yieldKept() {
      if (kept) entries.drop(kept.key)
    },
    /** Sets the total, and evicts at once what no longer fits. */
    resize(cpu: number) {
      checkBytes(cpu)
      total = cpu
      levels.resize(textureLevelShare(cpu))
      fit()
    },
    /** `session` reads through the cache, its reserve and its eviction in place, until the
     *  returned detach; one at a time. */
    attach(session: Holder) {
      holder = session
      return () => {
        if (holder === session) holder = undefined
      }
    },
    /** Whether `session` is the one reading through the cache. */
    attached: (session: Holder) => holder === session,
    /** Empties the cache: its owner is gone. */
    clear() {
      cache.keepOnly()
      entries.clear()
      levels.close()
      pages = 0
    },
  }
  /** Bytes `[offset, offset + length)` of the file at `url`, by an HTTP Range, for every load and
   *  session that reads through this cache: a file its server answers whole is read once and kept
   *  here (`createRangedReads`). */
  return Object.assign(cache, { readRange: createRangedReads(cache) })
}

/** The decoded-page cache a session reads through (`createPageCache`). */
export type PageCache = ReturnType<typeof createPageCache>
