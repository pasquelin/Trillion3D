import {
  requestedLevelBytes,
  type TextureLevel,
  type TextureLevelReader,
  type TextureLevelRequest,
} from '../../texture/levelReader.ts';
import { createTextureLevelStore, textureLevelShare } from '../../texture/levelStore.ts';
import { DEFAULT_CACHED_BYTES } from '../../streaming/pageCache.ts';
import { LevelBytesError } from './writeBlocks.ts';
import { tileRecord, tiledLevelBytes } from '../../texture/tileRecords.ts';
import { PREVIEW_LOSSLESS_FORMAT } from '../../../../sdk-core/src/index.ts';

/**
 * Decoded cooked levels, held long enough to cut tiles from them.
 *
 * A lossless tile is read in its whole level, decoded by the browser: a PNG is not cut by bytes. A
 * block tile is read alone, its record by one HTTP Range (STR-12, #962, `texture/tileRecords.ts`);
 * a server that ignores Range sends the whole file, held under the level's key, every tile of the
 * level cut from it, whole files asked since. Levels and records stay, the least recently read
 * leaving first, in the store the reader names — that of the page cache the session reads through,
 * within its CPU total, a world's kept across a device loss (`texture/levelStore.ts`) — or, for a
 * reader that names none, in one of its own, at the share of the default total. That is the chain's
 * only host memory, and it does not depend on the scene. A level that cannot fit beside the pages
 * kept is not read: its tile is refused, served by its coarse level until room comes back.
 *
 * An in-flight read is never doubled, and a failure is returned to the caller, never retried in
 * silence: the tile will stay served by its coarse level, and the diagnostic will say so. A block
 * answer that is neither the record asked nor the whole file its dimensions imply is refused where
 * the read resolves — reported once, never held, never read again: the file is what it is.
 */
export type LevelKey = TextureLevelRequest;

/** A tile of a level: the level's dimensions, and the tile's column and row. */
type LevelTile = readonly [width: number, height: number, tx: number, ty: number];

export type WebgpuTileLevels = {
  /** What the tile is cut from if it is there, marking it read — a lossless level, or a block
   *  tile's record —; otherwise `undefined`, launching nothing. */
  get(key: LevelKey, tile: LevelTile): TextureLevel | undefined;
  /** Starts the read if it is neither there, nor in flight, nor refused, and fits (the store's
   *  `room`, less the reads in flight); its bytes are reckoned and checked from the level's
   *  dimensions. False when it cannot fit at all: nothing will come until room comes back, and
   *  its tile stays at its coarser level. */
  request(key: LevelKey, frame: number, tile: LevelTile): boolean;
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
    // The cook the reader was made for: a read landing once the store holds another's keeps
    // nothing.
    key = read.store ? read.key : store.key;
  /** The room the levels may take, weighed once a frame: it walks the pages kept. */
  let roomFrame = -1,
    room = 0,
    /** Bytes the reads in flight will hold once landed. */
    reading = 0,
    fetched = 0,
    /** False once a server answered a Range with the whole file: whole files are asked since. */
    ranged = true;
  /** A block tile's record and its key in the store; none for a lossless level. */
  const recordOf = (level: LevelKey, [width, height, tx, ty]: LevelTile) =>
    level.format === PREVIEW_LOSSLESS_FORMAT
      ? undefined
      : { id: `${keyOf(level)}/${tx},${ty}`, ...tileRecord(width, height, tx, ty) };
  return {
    get(level, tile) {
      const record = recordOf(level, tile),
        whole = store.get(keyOf(level));
      if (!record) return whole;
      if (!whole) return store.get(record.id);
      return (whole as Uint8Array).subarray(record.offset, record.offset + record.bytes);
    },
    request(level, frame, tile) {
      const whole = keyOf(level),
        record = ranged ? recordOf(level, tile) : undefined,
        id = record?.id ?? whole;
      if (store.has(id) || store.has(whole) || pending.has(id) || refused.has(whole)) return true;
      if (frame !== roomFrame) [roomFrame, room] = [frame, store.room()];
      const size = [tile[0], tile[1]] as const;
      const bytes = record?.bytes ?? requestedLevelBytes(level, size);
      if (bytes > room) return false;
      // The reads in flight hold their room: one that fits only once they have landed waits for
      // them, rather than landing to shed a level read for a tile not cut yet.
      if (reading + bytes > room) return true;
      reading += bytes;
      const landing = read(record ? { ...level, range: record } : level)
        .then((texels) => {
          let held = id;
          if (texels instanceof Uint8Array && texels.byteLength !== record?.bytes) {
            if (texels.byteLength !== tiledLevelBytes(...size))
              throw new LevelBytesError(size, texels.byteLength);
            [held, ranged] = [whole, false];
          }
          fetched++;
          store.take(held, texels, key);
        })
        .catch((error: unknown) => {
          if (error instanceof LevelBytesError) refused.add(whole);
          options.onFailure(level, error);
        })
        .finally(() => {
          pending.delete(id);
          reading -= bytes;
        });
      pending.set(id, landing);
      return true;
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
