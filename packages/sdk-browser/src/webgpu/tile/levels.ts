import {
  requestedLevelBytes,
  type TextureLevel,
  type TextureLevelReader,
  type TextureLevelRequest,
} from '../../texture/levelReader.ts';
import { createTextureLevelStore, textureLevelShare } from '../../texture/levelStore.ts';
import { DEFAULT_CACHED_BYTES } from '../../streaming/pageCache.ts';
import { checkLevelBlocks, LevelBytesError } from './writeBlocks.ts';

/**
 * Decoded cooked levels, held long enough to cut tiles from them.
 *
 * A tile is read in the cache's whole level — decoded by the browser, or block-compressed as the
 * file holds it; neighbouring tiles of the same level generally arrive in the same images, and
 * re-reading a 2048² level for each would cost more than the transfer. Levels therefore stay, the
 * least recently read leaving first, in the store the reader names — that of the page cache the
 * session reads through, within its CPU total, a world's kept across a device loss
 * (`texture/levelStore.ts`) — or, for a reader that names none, in one of its own, at the share of
 * the default total. That is the chain's only host memory, and it does not depend on the scene. A level that cannot fit beside the pages kept is not read: its tile stays served by its
 * coarse level until room comes back.
 *
 * An in-flight read is never doubled, and a failure is returned to the caller, never retried in
 * silence: the tile will stay served by its coarse level, and the diagnostic will say so. A block
 * level whose bytes are not the whole blocks its dimensions imply is refused where the read
 * resolves — reported once, never held, never read again: the file is what it is.
 */
export type LevelKey = TextureLevelRequest;

export type WebgpuTileLevels = {
  /** The level if it is there, marking it read; otherwise `undefined`, launching nothing. */
  get(key: LevelKey): TextureLevel | undefined;
  /** Starts the read if it is neither there, nor in flight, nor refused, and fits (the store's
   *  `room`); `size` is the level's dimensions, what its bytes are reckoned and checked from. */
  request(key: LevelKey, frame: number, size: readonly [number, number]): void;
  readonly inFlight: number;
  readonly fetched: number;
  readonly bytes: number;
  /** Held when every in-flight read has succeeded or failed. */
  settled(): Promise<void>;
  destroy(): void;
};

// The format is in the key: a session that changes family mid-life reads the other file.
const keyOf = ({ sha256, atlas, level, format }: LevelKey) =>
  `${sha256}/${atlas}/${level}/${format}`;

export function createWebgpuTileLevels(options: {
  read: TextureLevelReader;
  onFailure: (key: LevelKey, error: unknown) => void;
}): WebgpuTileLevels {
  const { read } = options,
    store = read.store ?? createTextureLevelStore(textureLevelShare(DEFAULT_CACHED_BYTES)),
    pending = new Map<string, Promise<void>>(),
    refused = new Set<string>(),
    // The cook the reader opened: a read landing once the store holds another's keeps nothing.
    { key } = store;
  /** The room a level may take, weighed once a frame: it walks the pages kept. */
  let roomFrame = -1,
    room = 0,
    fetched = 0;
  return {
    get: (level) => store.get(keyOf(level)),
    request(level, frame, size) {
      const id = keyOf(level);
      if (store.has(id) || pending.has(id) || refused.has(id)) return;
      if (frame !== roomFrame) [roomFrame, room] = [frame, store.room()];
      if (requestedLevelBytes(level, size) > room) return;
      const reading = read(level)
        .then((texels) => {
          if (texels instanceof Uint8Array) checkLevelBlocks(texels, size);
          fetched++;
          store.take(id, texels, key);
        })
        .catch((error: unknown) => {
          if (error instanceof LevelBytesError) refused.add(id);
          options.onFailure(level, error);
        })
        .finally(() => pending.delete(id));
      pending.set(id, reading);
    },
    get inFlight() {
      return pending.size;
    },
    get fetched() {
      return fetched;
    },
    get bytes() {
      return store.bytes;
    },
    settled: () => Promise.all(pending.values()).then(() => undefined),
    /** Closes the store made here; the reader's is its page cache's, which closes it. */
    destroy() {
      if (!read.store) store.close();
    },
  };
}
