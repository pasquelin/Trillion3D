import {
  requestedLevelBytes,
  type TextureLevel,
  type TextureLevelReader,
  type TextureLevelRequest,
} from './levelReader.ts'
import { createTextureLevelStore, textureLevelShare } from './levelStore.ts'
import { DEFAULT_CACHED_BYTES } from '../streaming/pageCache.ts'
import { createReadFailures } from '../streaming/failures.ts'
import { retriableError } from '../cluster/checked.ts'
import { tileRecord } from './tileRecords.ts'
import { PREVIEW_LOSSLESS_FORMAT } from '../../../sdk-core/src/index.ts'

/**
 * Cooked levels and block tile records, held long enough to cut tiles from them.
 *
 * A lossless tile is read in its whole level, decoded by the browser: a PNG is not cut by bytes. A
 * block tile is read alone, its record by one HTTP Range through its file's one reader
 * (`levelReader.ts`, `texture/tileRecords.ts`). Levels and records stay, the least recently read
 * leaving first, in the store the reader names — that of the page cache the session reads through,
 * within its CPU total, a world's kept across a device loss (`texture/levelStore.ts`) — or, for a
 * reader that names none, in one of its own, at the share of the default total. That is the chain's
 * only host memory, and it does not depend on the scene. A level that cannot fit beside the pages
 * kept is not read: its tile is refused, served by its coarse level until room comes back.
 *
 * An in-flight read is never doubled. A failure is returned to the caller, and its level file
 * waits its turn by the one failure policy (`streaming/failures.ts`): no tile of it is asked again
 * before its wait ends, however many frames want it. One another request would meet again — a 4xx,
 * or a block answer that is not the record asked — is refused for good: reported once, never held,
 * never read again. Its tiles stay served by their coarse level, and the diagnostic says so.
 */
export type LevelKey = TextureLevelRequest

/** Block bytes that are not the whole blocks their dimensions imply: a tile's record answered
 *  short or foreign, or a tail level (`webgpu/tile/writeBlocks.ts`). */
export class LevelBytesError extends Error {
  constructor([width, height]: readonly [number, number], bytes: number) {
    super(`TEXTURE_LEVEL_BYTES ${width}x${height}: ${bytes}`)
  }
}
type Size = readonly [width: number, height: number]

export type HeldLevels = {
  /** What the tile is cut from if it is there, marking it read — a lossless level, or a block
   *  tile's record —; otherwise `undefined`, launching nothing. */
  get(key: LevelKey, tx: number, ty: number): TextureLevel | undefined
  /** Starts the read if it is neither there, nor in flight, nor held back by a failure, and fits
   *  (the store's `room`, less the reads in flight); its bytes are reckoned and checked from the
   *  level's dimensions, `size`. False when it cannot fit at all: nothing will come until room comes
   *  back, and its tile stays at its coarser level. */
  request(key: LevelKey, frame: number, size: Size, tx: number, ty: number): boolean
  readonly inFlight: number
  readonly fetched: number
  readonly bytes: number
  /** Held when every in-flight read has succeeded or failed. */
  settled(): Promise<void>
  destroy(): void
}

// The format is in the key: a session that changes family mid-life reads the other file.
const keyOf = ({ sha256, atlas, level, format }: LevelKey) =>
  `${sha256}/${atlas}/${level}/${format}`
/** What `level` is held under: the whole level when lossless, else the tile `tx`, `ty`'s record. */
const idOf = (level: LevelKey, tx: number, ty: number) =>
  level.format === PREVIEW_LOSSLESS_FORMAT ? keyOf(level) : `${keyOf(level)}/${tx},${ty}`

export function createHeldLevels(options: {
  read: TextureLevelReader
  onFailure: (key: LevelKey, error: unknown) => void
}): HeldLevels {
  const { read } = options,
    store = read.store ?? createTextureLevelStore(textureLevelShare(DEFAULT_CACHED_BYTES)),
    pending = new Map<string, Promise<void>>(),
    /** Each level file's failures in a row, by its key. */
    failures = createReadFailures(),
    // The cook the reader was made for: a read landing once the store holds another's keeps
    // nothing.
    key = read.store ? read.key : store.key
  /** The room the levels may take, weighed once a frame: it walks the pages kept. */
  let roomFrame = -1,
    room = 0,
    /** Bytes the reads in flight will hold once landed. */
    reading = 0,
    fetched = 0
  return {
    get: (level, tx, ty) => store.get(idOf(level, tx, ty)),
    request(level, frame, size, tx, ty) {
      const file = keyOf(level),
        id = idOf(level, tx, ty)
      if (store.has(id) || pending.has(id) || failures.blocked(file)) return true
      if (frame !== roomFrame) [roomFrame, room] = [frame, store.room()]
      // The record is reckoned where it is needed: a waiting tile asks every frame.
      const record =
          level.format === PREVIEW_LOSSLESS_FORMAT
            ? undefined
            : tileRecord(size[0], size[1], tx, ty),
        bytes = record?.bytes ?? requestedLevelBytes(level, size)
      if (bytes > room) return false
      // The reads in flight hold their room: one that fits only once they have landed waits for
      // them, rather than landing to shed a level read for a tile not cut yet.
      if (reading + bytes > room) return true
      reading += bytes
      const landing = read(record ? { ...level, range: record } : level)
        .then((texels) => {
          if (texels instanceof Uint8Array && texels.byteLength !== record?.bytes)
            throw new LevelBytesError(size, texels.byteLength)
          failures.passed(file)
          fetched++
          store.take(id, texels, key)
        })
        .catch((error: unknown) => {
          failures.record(file, error, !(error instanceof LevelBytesError) && retriableError(error))
          options.onFailure(level, error)
        })
        .finally(() => {
          pending.delete(id)
          reading -= bytes
        })
      pending.set(id, landing)
      return true
    },
    get inFlight() {
      return pending.size
    },
    get fetched() {
      return fetched
    },
    get bytes() {
      return store.bytes
    },
    settled: () => Promise.all(pending.values()).then(() => undefined),
    /** Closes the store made here; the reader's is its page cache's, which closes it. */
    destroy() {
      failures.clear()
      if (!read.store) store.close()
    },
  }
}

/** Cooked-level reads in flight at most: beyond that, a level waits for the next image. */
const MAX_LEVEL_READS = 6

/**
 * THE ONE READ OF A HELD LEVEL, tiles' and impostor atlases' alike: what `levels` holds of `key`
 * (the tile `tx`, `ty`'s record for a block level), marked read; otherwise its read asked —
 * never doubled, within the store's room, a failure reported by `levels` — and `waiting` until it
 * lands. `refused` when `roomFor` says the caller has no place for it, or the level cannot fit
 * beside what the store keeps: nothing will come until room comes back, and nothing was read.
 */
export function readHeldLevel(
  levels: HeldLevels,
  key: LevelKey,
  frame: number,
  size: Size,
  tx = 0,
  ty = 0,
  roomFor: () => boolean = () => true,
): TextureLevel | 'waiting' | 'refused' {
  const held = levels.get(key, tx, ty)
  if (held) return held
  if (!roomFor()) return 'refused'
  if (levels.inFlight >= MAX_LEVEL_READS) return 'waiting'
  return levels.request(key, frame, size, tx, ty) ? 'waiting' : 'refused'
}
