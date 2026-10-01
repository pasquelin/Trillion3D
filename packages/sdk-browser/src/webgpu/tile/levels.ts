import {
  requestedLevelBytes,
  type TextureLevel,
  type TextureLevelReader,
  type TextureLevelRequest,
} from '../../texture/levelReader.ts';
import { createTextureLevelStore, textureLevelShare } from '../../texture/levelStore.ts';
import { DEFAULT_CACHED_BYTES } from '../../streaming/pageCache.ts';
import { LevelBytesError } from './writeBlocks.ts';
import { tileRecord } from '../../texture/tileRecords.ts';
import { PREVIEW_LOSSLESS_FORMAT } from '../../../../sdk-core/src/index.ts';

/**
 * Cooked levels and block tile records, held long enough to cut tiles from them.
 *
 * A lossless tile is read in its whole level, decoded by the browser: a PNG is not cut by bytes. A
 * block tile is read alone, its record by one HTTP Range (STR-12, #962, `texture/tileRecords.ts`);
 * a server that ignores Range sends the whole file, held under the level's key, every tile of the
 * level cut from it, whole files asked since. Until a first record says which, one ranged read goes
 * alone. Levels and records stay, the least recently read
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
type Size = readonly [width: number, height: number];

export type WebgpuTileLevels = {
  /** What the tile is cut from if it is there, marking it read — a lossless level, or a block
   *  tile's record —; otherwise `undefined`, launching nothing. */
  get(key: LevelKey, size: Size, tx: number, ty: number): TextureLevel | undefined;
  /** Starts the read if it is neither there, nor in flight, nor refused, and fits (the store's
   *  `room`, less the reads in flight); its bytes are reckoned and checked from the level's
   *  dimensions, `size`. False when it cannot fit at all: nothing will come until room comes back, and
   *  its tile stays at its coarser level. */
  request(key: LevelKey, frame: number, size: Size, tx: number, ty: number): boolean;
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
/** A block tile's record, under its level's key. */
const recordKey = (whole: string, tx: number, ty: number) => `${whole}/${tx},${ty}`;

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
    /** Whether the server honours Range: unknown until a first block read lands, false once it
     *  answered one with the whole file — whole files are asked since. */
    ranged: boolean | undefined,
    /** A ranged read is in flight while `ranged` is unknown: the others wait for its answer. */
    probing = false;
  return {
    get(level, size, tx, ty) {
      const whole = keyOf(level),
        held = store.get(whole);
      if (level.format === PREVIEW_LOSSLESS_FORMAT) return held;
      if (!held) return store.get(recordKey(whole, tx, ty));
      const { offset, bytes } = tileRecord(size[0], size[1], tx, ty);
      return (held as Uint8Array).subarray(offset, offset + bytes);
    },
    request(level, frame, size, tx, ty) {
      const whole = keyOf(level),
        ranges = ranged !== false && level.format !== PREVIEW_LOSSLESS_FORMAT,
        id = ranges ? recordKey(whole, tx, ty) : whole;
      if (store.has(id) || store.has(whole) || pending.has(id) || refused.has(whole)) return true;
      // Until a first record lands, one ranged read probes the server alone: one that ignores
      // Range answers each read with the whole file, and six of them would all download it.
      if (ranges && probing) return true;
      if (frame !== roomFrame) [roomFrame, room] = [frame, store.room()];
      // The whole file's length is reckoned where it is needed: a waiting tile asks every frame.
      const wholeBytes = () => requestedLevelBytes(level, size),
        record = ranges ? tileRecord(size[0], size[1], tx, ty) : undefined,
        bytes = record?.bytes ?? wholeBytes();
      if (bytes > room) return false;
      // The reads in flight hold their room: one that fits only once they have landed waits for
      // them, rather than landing to shed a level read for a tile not cut yet.
      if (reading + bytes > room) return true;
      reading += bytes;
      const probe = ranges && ranged === undefined;
      if (probe) probing = true;
      const landing = read(record ? { ...level, range: record } : level)
        .then((texels) => {
          let held = id;
          const levelBytes = wholeBytes();
          if (texels instanceof Uint8Array && texels.byteLength !== record?.bytes) {
            if (texels.byteLength !== levelBytes)
              throw new LevelBytesError(size, texels.byteLength);
            [held, ranged] = [whole, false];
          } else if (record && record.bytes !== levelBytes) ranged ??= true; // a 206: Range honoured
          fetched++;
          store.take(held, texels, key);
        })
        .catch((error: unknown) => {
          if (error instanceof LevelBytesError) refused.add(whole);
          options.onFailure(level, error);
        })
        .finally(() => {
          if (probe) probing = false;
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

/** Cooked-level reads in flight at most: beyond that, a level waits for the next image. */
const MAX_LEVEL_READS = 6;

/**
 * THE ONE READ OF A HELD LEVEL, tiles' and impostor atlases' alike: what `levels` holds of `key`
 * (the tile `tx`, `ty`'s record for a block level), marked read; otherwise its read asked —
 * never doubled, within the store's room, a failure reported by `levels` — and `waiting` until it
 * lands. `refused` when `roomFor` says the caller has no place for it, or the level cannot fit
 * beside what the store keeps: nothing will come until room comes back, and nothing was read.
 */
export function readHeldLevel(
  levels: WebgpuTileLevels,
  key: LevelKey,
  frame: number,
  size: Size,
  tx = 0,
  ty = 0,
  roomFor: () => boolean = () => true,
): TextureLevel | 'waiting' | 'refused' {
  const held = levels.get(key, size, tx, ty);
  if (held) return held;
  if (!roomFor()) return 'refused';
  if (levels.inFlight >= MAX_LEVEL_READS) return 'waiting';
  return levels.request(key, frame, size, tx, ty) ? 'waiting' : 'refused';
}
