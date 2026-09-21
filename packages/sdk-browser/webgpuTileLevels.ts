import {
  closeTextureLevel,
  textureLevelBytes,
  type TextureLevel,
  type TextureLevelReader,
  type TextureLevelRequest,
} from './textureLevelReader.ts';

/**
 * Decoded cooked levels, held long enough to cut tiles from them.
 *
 * A tile is read in the cache's whole level — decoded by the browser, or block-compressed as the
 * file holds it; neighbouring tiles of the same level generally arrive in the same images, and
 * re-reading a 2048² level for each would cost more than the transfer. Levels therefore stay here,
 * under a fixed host-byte budget, the least recently read leaving first. That is the chain's only
 * host memory, and it does not depend on the scene.
 *
 * An in-flight read is never doubled, and a failure is returned to the caller, never retried in
 * silence: the tile will stay served by its coarse level, and the diagnostic will say so.
 */
export type LevelKey = TextureLevelRequest;

export type WebgpuTileLevels = {
  /** The level if it is there, marking it read; otherwise `undefined`, launching nothing. */
  get(key: LevelKey, frame: number): TextureLevel | undefined;
  /** Starts the read if it is neither there nor in flight. */
  request(key: LevelKey, frame: number): void;
  readonly inFlight: number;
  readonly fetched: number;
  readonly bytes: number;
  /** Held when every in-flight read has succeeded or failed. */
  settled(): Promise<void>;
  destroy(): void;
};

const keyOf = ({ sha256, atlas, level }: LevelKey) => `${sha256}/${atlas}/${level}`;

export function createWebgpuTileLevels(options: {
  read: TextureLevelReader;
  budgetBytes: number;
  onFailure: (key: LevelKey, error: unknown) => void;
}): WebgpuTileLevels {
  const held = new Map<string, { level: TextureLevel; bytes: number; lastUse: number }>();
  const pending = new Map<string, Promise<void>>();
  let bytes = 0,
    fetched = 0;
  const drop = (id: string) => {
    const entry = held.get(id);
    if (!entry) return;
    held.delete(id);
    bytes -= entry.bytes;
    closeTextureLevel(entry.level);
  };
  /** Makes room for `needed` bytes: the least recently read leaves first. */
  const makeRoom = (needed: number) => {
    while (bytes + needed > options.budgetBytes && held.size) {
      let oldest: string | undefined,
        oldestUse = Infinity;
      for (const [id, entry] of held)
        if (entry.lastUse < oldestUse) {
          oldestUse = entry.lastUse;
          oldest = id;
        }
      if (oldest !== undefined) drop(oldest);
    }
  };
  return {
    get(key, frame) {
      const entry = held.get(keyOf(key));
      if (!entry) return undefined;
      entry.lastUse = frame;
      return entry.level;
    },
    request(key, frame) {
      const id = keyOf(key);
      if (held.has(id) || pending.has(id)) return;
      const read = options
        .read(key)
        .then((level) => {
          fetched++;
          const size = textureLevelBytes(level);
          makeRoom(size);
          held.set(id, { level, bytes: size, lastUse: frame });
          bytes += size;
        })
        .catch((error: unknown) => options.onFailure(key, error))
        .finally(() => pending.delete(id));
      pending.set(id, read);
    },
    get inFlight() {
      return pending.size;
    },
    get fetched() {
      return fetched;
    },
    get bytes() {
      return bytes;
    },
    settled: () => Promise.all(pending.values()).then(() => undefined),
    destroy() {
      for (const id of [...held.keys()]) drop(id);
    },
  };
}
