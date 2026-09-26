import { closeTextureLevel, textureLevelBytes, type TextureLevel } from './levelReader.ts';

/** The decoded texture levels' share of the page cache, at most: three quarters, 192 MiB at the
 *  default CPU total. */
export const textureLevelShare = (pageCacheBytes: number) => Math.floor((pageCacheBytes * 3) / 4);

/**
 * The decoded baked levels tiles are cut from (`webgpu/tile/levels.ts`), by id, the least recently
 * read first, within `budgetBytes` and within what the pages kept leave them (`roomBeside`). A
 * world's page cache holds one across its sessions (`PageCache.levels`): a level belongs to no GPU
 * device, so a session reopened after a device loss cuts its tiles again from the levels held and
 * reads none again. It keeps the levels of one cook, `key`; `undefined` once closed, and a read
 * landing for another key keeps nothing. `onHeld` hears each level taken in.
 */
export function createTextureLevelStore(budgetBytes: number, key = '') {
  const held = new Map<string, { level: TextureLevel; bytes: number }>();
  const store = {
    pending: new Map<string, Promise<void>>(),
    refused: new Set<string>(),
    bytes: 0,
    budgetBytes,
    key: key as string | undefined,
    /** Bytes the levels may take beside what the owner keeps first; unbounded by default. */
    roomBeside: () => Infinity,
    onHeld: undefined as (() => void) | undefined,
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
    room: () => Math.min(store.budgetBytes, store.roomBeside()),
    /** Holds `level` under `id`, the least recently read leaving for it; false, holding nothing,
     *  when it cannot fit (`room`). */
    take(id: string, level: TextureLevel) {
      const bytes = textureLevelBytes(level);
      if (bytes > store.room()) return false;
      store.shedTo(store.budgetBytes - bytes);
      held.set(id, { level, bytes });
      store.bytes += bytes;
      store.onHeld?.();
      return true;
    },
    drop(id: string) {
      const entry = held.get(id);
      if (!entry) return;
      held.delete(id);
      store.bytes -= entry.bytes;
      closeTextureLevel(entry.level);
    },
    /** Drops the least recently read levels until the rest fit in `limit`; the bytes freed. */
    shedTo(limit: number) {
      const before = store.bytes;
      for (const id of held.keys()) {
        if (store.bytes <= limit) break;
        store.drop(id);
      }
      return before - store.bytes;
    },
    /** A new share, applied at once. */
    resize(bytes: number) {
      store.budgetBytes = bytes;
      store.shedTo(bytes);
    },
    /** Keeps only the levels of the cook `next`, as its scene opens (the proxy's `keepOnly`). */
    keepOnly(next: string) {
      store.key = next;
      for (const id of held.keys()) if (!id.endsWith(`#${next}`)) store.drop(id);
    },
    /** Closes everything: the owner is gone, and a read landing after keeps nothing. */
    close() {
      store.key = undefined;
      store.shedTo(0);
    },
  };
  return store;
}

/** What a page cache keeps of the decoded texture levels (`createTextureLevelStore`). */
export type TextureLevelStore = ReturnType<typeof createTextureLevelStore>;
