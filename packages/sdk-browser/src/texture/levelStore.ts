import { closeTextureLevel, textureLevelBytes, type TextureLevel } from './levelReader.ts';
import { evictOldest } from '../streaming/evictOldest.ts';

/** The decoded texture levels' share of the page cache, at most: three quarters, 192 MiB at the
 *  default CPU total. */
export const textureLevelShare = (pageCacheBytes: number) => Math.floor((pageCacheBytes * 3) / 4);

/**
 * The decoded baked levels tiles are cut from (`webgpu/tile/levels.ts`), by id, the least recently
 * read first, within `budgetBytes` and within what the pages kept leave them (`roomBeside`). A
 * world's page cache holds one across its sessions (`PageCache.levels`): a level belongs to no GPU
 * device, so a session reopened after a device loss cuts its tiles again from the levels held and
 * reads none again. It keeps the levels of one cook, `key`; `undefined` once closed, and a read
 * landing for another key keeps nothing. `roomBeside` is what its owner leaves the levels
 * (unbounded by default), `onHeld` hears each level taken in.
 */
export function createTextureLevelStore(
  budgetBytes: number,
  { roomBeside = () => Infinity, onHeld }: { roomBeside?: () => number; onHeld?: () => void } = {},
) {
  const held = new Map<string, { level: TextureLevel; bytes: number }>();
  const drop = (id: string) => {
    const entry = held.get(id);
    if (!entry) return;
    held.delete(id);
    store.bytes -= entry.bytes;
    closeTextureLevel(entry.level);
  };
  const store = {
    bytes: 0,
    budgetBytes,
    key: '' as string | undefined,
    has: (id: string) => held.has(id),
    /** The level held under `id`, marked read last: it leaves last. */
    get(id: string) {
      const entry = held.get(id);
      if (!entry) return undefined;
      held.delete(id);
      held.set(id, entry);
      return entry.level;
    },
    /** Bytes one level may take: the share, within what is left beside. */
    room: () => Math.min(store.budgetBytes, roomBeside()),
    /** Holds `level`, read for the cook `key`, under `id`, the least recently read leaving for it.
     *  The store owns it from here: it closes it, holding nothing, when another cook is open or
     *  when it cannot fit (`room`). A level already held — read meanwhile by the session a device
     *  loss replaced — stays, marked read last, and the copy closes: its bytes are counted once. */
    take(id: string, level: TextureLevel, key: string | undefined) {
      if (key === undefined || key !== store.key || store.get(id)) return closeTextureLevel(level);
      const bytes = textureLevelBytes(level),
        room = store.room();
      if (bytes > room) return closeTextureLevel(level);
      store.shedTo(room - bytes);
      held.set(id, { level, bytes });
      store.bytes += bytes;
      onHeld?.();
    },
    /** Drops the least recently read levels until the rest fit in `limit`; the bytes freed. */
    shedTo(limit: number) {
      const before = store.bytes;
      evictOldest(
        held.keys(),
        () => store.bytes > limit,
        () => false,
        drop,
      );
      return before - store.bytes;
    },
    /** A new share, applied at once, within what is left beside. */
    resize(bytes: number) {
      store.budgetBytes = bytes;
      store.shedTo(store.room());
    },
    /** Keeps only the levels of the cook `next`, as its scene opens (the proxy's `keepOnly`). */
    keepOnly(next: string | undefined) {
      if (next === store.key) return;
      store.key = next;
      store.shedTo(0);
    },
    /** Closes everything: the owner is gone, and a read landing after keeps nothing. */
    close: () => store.keepOnly(undefined),
  };
  return store;
}

/** What a page cache keeps of the decoded texture levels (`createTextureLevelStore`). */
export type TextureLevelStore = ReturnType<typeof createTextureLevelStore>;
