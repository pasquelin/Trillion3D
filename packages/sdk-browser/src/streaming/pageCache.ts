import { evictOldest } from './evictOldest.ts';

/** The CPU total by default. Streaming bundles are far larger than a single cluster page, so a
 *  cache bounded only by entry count would hold hundreds of megabytes. */
export const DEFAULT_CACHED_BYTES = 256 * 1024 * 1024;

/** Bytes one catalogue entry is reckoned to hold beside its strings: the record and its place in
 *  the manifest's indexes (by url, by page id, by bundle), a fixed rule, never read from the
 *  machine. */
const TABLE_ENTRY_BYTES = 128;
/** Bytes of a fingerprint's hexadecimal string. */
const SHA256_CHARS = 64;

/** CPU bytes the manifest tables of `pages` hold: each entry's url and fingerprint as UTF-16
 *  strings, and its record in the indexes. */
export const manifestTableBytes = (pages: Iterable<{ url: string }>) => {
  let bytes = 0;
  for (const page of pages) bytes += 2 * (page.url.length + SHA256_CHARS) + TABLE_ENTRY_BYTES;
  return bytes;
};

/** A session's hold on the cache: what it reserves off the total, which may change while it reads,
 *  and how it evicts — past its pins and its transfers — when the total shrinks. */
type Holder = { reserved(): number; evict(): void };

const checkBytes = (bytes: number) => {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new Error('INVALID_PAGE_CACHE_BUDGET');
};

/**
 * The decoded-page cache: the bytes of every page and bundle read, least recently used first, and
 * the CPU total they count against (`cpuBytes`, `world.budget.cpu`). One cache, which its owner
 * keeps across sessions: a world hands the same one to every session it opens, so a session
 * reopened — on a device granted again after a loss, or on a scene that changed — reads what the
 * last one fetched from here, and fetches nothing it holds.
 *
 * The total is shared by a fixed rule: the session reading through it reserves its manifest
 * tables, its transfer queue and the engine's tables (`manifestTableBytes`, `maxTransferBytes`, the
 * streamer's `reserve`), the files kept whole beside them theirs (`keep`), and the pages hold the
 * rest (`budgetBytes`). A total set lower applies at once: pages leave by last use until they fit,
 * save those the session pins.
 */
export function createPageCache(cpuBytes = DEFAULT_CACHED_BYTES) {
  checkBytes(cpuBytes);
  const pages = new Map<string, Uint8Array>();
  /** Files kept whole beside the pages, by url, and the bytes each takes off the total. */
  const kept = new Map<string, { bytes: number; array?: Uint8Array }>();
  let keptBytes = 0;
  const unkeep = (url: string) => {
    keptBytes -= kept.get(url)?.bytes ?? 0;
    kept.delete(url);
  };
  let bytes = 0,
    total = cpuBytes,
    holder: Holder | undefined;
  const drop = (url: string) => {
    const held = pages.get(url);
    if (!held) return;
    bytes -= held.byteLength;
    pages.delete(url);
  };
  /** Pages leave by last use until they fit: through the session in place, which keeps its pins
   *  and its transfers, or all of them evictable when none reads. */
  const evict = () => {
    if (holder) holder.evict();
    else
      evictOldest(
        pages.keys(),
        () => bytes > cache.budgetBytes,
        () => false,
        drop,
      );
  };
  const cache = {
    /** The pages, by url, least recently used first. */
    pages: pages as ReadonlyMap<string, Uint8Array>,
    /** Bytes the pages hold. */
    get bytes() {
      return bytes;
    },
    /** The CPU total: pages, manifest tables, transfer queue and engine tables together. */
    get cpuBytes() {
      return total;
    },
    /** Bytes reserved off the total: the session's in place, and the kept files'. */
    get reservedBytes() {
      return (holder?.reserved() ?? 0) + keptBytes;
    },
    /** Bytes the pages may hold: the total less what the session reserves. */
    get budgetBytes() {
      return Math.max(0, total - cache.reservedBytes);
    },
    /** Puts `array` as the most recently used page at `url`. */
    touch(url: string, array: Uint8Array) {
      drop(url);
      pages.set(url, array);
      bytes += array.byteLength;
    },
    drop,
    /** Drops every page `sizes` names at another size: another page under the same url. */
    dropResized(sizes: ReadonlyMap<string, { bytes: number }>) {
      for (const [url, held] of pages)
        if ((sizes.get(url)?.bytes ?? held.byteLength) !== held.byteLength) drop(url);
    },
    /**
     * A file kept whole beside the pages — a scene's resident proxy —, never evicted: `bytes` come
     * off the total from the moment it is asked, while it is in flight; `array` once it lands. It
     * stays kept, across sessions, until `keepOnly` no longer names it.
     */
    keep(url: string, bytes: number, array?: Uint8Array) {
      unkeep(url);
      kept.set(url, { bytes, array });
      keptBytes += bytes;
      evict();
    },
    /** Bytes the kept files take off the total. */
    get keptBytes() {
      return keptBytes;
    },
    /** The bytes of a kept file that landed. */
    kept: (url: string) => kept.get(url)?.array,
    /** Keeps only the files `urls` names: those of a scene gone leave, or one that failed. */
    keepOnly(urls: readonly string[]) {
      for (const url of kept.keys()) if (!urls.includes(url)) unkeep(url);
    },
    /** Sets the total, and evicts at once what no longer fits. */
    resize(cpu: number) {
      checkBytes(cpu);
      total = cpu;
      evict();
    },
    /** A session reads through the cache until the returned release; one at a time. */
    hold(next: Holder) {
      holder = next;
      return () => {
        if (holder === next) holder = undefined;
      };
    },
    /** Empties the cache: its owner is gone. */
    clear() {
      pages.clear();
      kept.clear();
      bytes = keptBytes = 0;
    },
  };
  return cache;
}

/** The decoded-page cache a session reads through (`createPageCache`). */
export type PageCache = ReturnType<typeof createPageCache>;
