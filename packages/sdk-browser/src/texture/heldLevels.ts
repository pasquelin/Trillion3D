/**
 * THE ONE READ OF A HELD LEVEL, tiles' and impostor atlases' alike: the cooked levels and block
 * tile records a session cuts its tiles from, read through its level reader and held among the
 * page cache's entries under the reader's cook (`TextureLevelReader.store`,
 * `streaming/pageCache.ts`), within its one budget, the least recently read leaving first. That is
 * the chain's only host memory, and it does not depend on the scene.
 *
 * A lossless level is read whole, decoded by the browser: a PNG is not cut by bytes. A block tile
 * is read alone, its record by one HTTP Range (`levelReader.ts`, `tileRecords.ts`), its length
 * checked. A read is asked only when it fits in what eviction can free beside the reads in flight
 * (`PageCache.roomBytes`); one that cannot fit at all is refused, its tile served by its coarse
 * level until room comes back. An in-flight read is never doubled.
 *
 * A read that fails is reported to the asker that launched it, and what it read — a lossless
 * level's file, a block level's record, each apart — is held back by the one failure policy
 * (`streaming/failures.ts`), which says when it is asked again, if ever; a record answered short or
 * foreign is refused for good. Its tile stays served by its coarse level meanwhile. The failures
 * live with the reader, one per level or record asked at most.
 *
 * An asker that asks the same levels every frame and needs them all at once — an impostor atlas
 * (`impostor/atlas.ts`) — builds their asks once (`ask`), holds them in the cache while it gathers
 * them (`hold`), so a level landing never evicts another of its set, and lets them go once it is
 * done (`letGo`).
 */
import {
  bitmapBytes,
  type TextureLevel,
  type TextureLevelAddress,
  type TextureLevelReader,
  type TextureLevelRequest,
} from './levelReader.ts'
import { createReadFailures } from '../streaming/failures.ts'
import { retriableError } from '../cluster/checked.ts'
import { tileRecord } from './tileRecords.ts'
import { PREVIEW_LOSSLESS_FORMAT } from '../../../sdk-core/src/index.ts'

/** Block bytes that are not the whole blocks their dimensions imply: a tile's record answered
 *  short or foreign, or a tail level (`webgpu/tile/writeBlocks.ts`). */
export class LevelBytesError extends Error {
  constructor([width, height]: readonly [number, number], bytes: number) {
    super(`TEXTURE_LEVEL_BYTES ${width}x${height}: ${bytes}`)
  }
}
type Size = readonly [width: number, height: number]
/** Hears a read its asker launched that failed. */
export type LevelFailed = (address: TextureLevelAddress, error: unknown) => void
/** A whole level as an asker keeps it from one frame to the next (`HeldLevels.ask`): its address,
 *  its size, and what it is held under, built once. */
export type LevelAsk = {
  readonly address: TextureLevelAddress
  readonly size: Size
  readonly id: string
}

/** Cooked-level reads in flight at most: beyond that, a level waits for the next image. */
const MAX_LEVEL_READS = 6
const always = () => true

/** What `address` is held under for the cook `cook`, one string a tile asks: the whole level when
 *  `lossless` — its file —, else the tile `tx`, `ty`'s record. The format is in it: a session that
 *  changes family mid-life reads the other file. */
function levelId(
  cook: string,
  { sha256, atlas, level, format }: TextureLevelAddress,
  lossless: boolean,
  tx: number,
  ty: number,
) {
  const file = `${cook}/${sha256}/${atlas}/${level}/${format}`
  return lossless ? file : `${file}/${tx},${ty}`
}

function createHeldLevels(read: TextureLevelReader) {
  const { store, key } = read,
    pending = new Map<string, Promise<void>>(),
    failures = createReadFailures({
      retriable: (error) => !(error instanceof LevelBytesError) && retriableError(error),
    }),
    /** Who hears each level land. */
    watchers = new Set<() => void>()
  /** Bytes the reads in flight will hold once landed. */
  let reading = 0,
    fetched = 0
  /** Reads `request`, `bytes` once landed, and holds it under `id`; a failure told `failed`. */
  const launch = (
    id: string,
    request: TextureLevelRequest,
    size: Size,
    bytes: number,
    failed: LevelFailed,
  ) => {
    reading += bytes
    const landing = read(request)
      .then((level) => {
        if (level instanceof Uint8Array && level.byteLength !== request.range?.bytes)
          throw new LevelBytesError(size, level.byteLength)
        failures.passed(id)
        fetched++
        store.keepLevel(id, level)
        for (const landed of watchers) landed()
      })
      .catch((error: unknown) => {
        failures.record(id, error)
        failed(request, error)
      })
      .finally(() => {
        pending.delete(id)
        reading -= bytes
      })
    pending.set(id, landing)
  }
  /** `read`, `id` the level's: what it is held under. */
  const readId = (
    id: string,
    address: TextureLevelAddress,
    size: Size,
    failed: LevelFailed,
    tx: number,
    ty: number,
    roomFor: () => boolean,
  ): TextureLevel | 'waiting' | 'refused' => {
    const held = store.level(id)
    if (held) return held
    if (!roomFor()) return 'refused'
    if (pending.has(id) || failures.blocked(id) || pending.size >= MAX_LEVEL_READS) return 'waiting'
    // The record is reckoned where it is needed: a waiting tile asks every frame.
    const range =
        address.format === PREVIEW_LOSSLESS_FORMAT
          ? undefined
          : tileRecord(size[0], size[1], tx, ty),
      bytes = range?.bytes ?? bitmapBytes(size[0], size[1]),
      room = store.roomBytes
    if (bytes > room) return 'refused'
    // The reads in flight hold their room: one that fits only once they have landed waits for
    // them, rather than landing to evict a level read for a tile not cut yet.
    if (reading + bytes > room) return 'waiting'
    launch(id, range ? { ...address, range } : address, size, bytes, failed)
    return 'waiting'
  }
  return {
    /**
     * What a tile is cut from — the lossless level `address` names, or the block tile `tx`, `ty`'s
     * record — marked read, the level `size` texels wide and high; otherwise `waiting` while its
     * read is asked — launched here when none is in flight or held back, its failure told
     * `failed` — and `refused` when `roomFor` says the caller has no place for it, or it cannot
     * fit at all: nothing will come until room comes back, and nothing was read.
     */
    read(
      address: TextureLevelAddress,
      size: Size,
      failed: LevelFailed,
      tx = 0,
      ty = 0,
      roomFor: () => boolean = always,
    ) {
      const id = levelId(key, address, address.format === PREVIEW_LOSSLESS_FORMAT, tx, ty)
      return readId(id, address, size, failed, tx, ty, roomFor)
    },
    /** The ask of the level `address` names, `size` texels wide and high, as `read` asks it at
     *  tile 0, 0 — a lossless level whole —, built once. */
    ask: (address: TextureLevelAddress, size: Size): LevelAsk => ({
      address,
      size,
      id: levelId(key, address, address.format === PREVIEW_LOSSLESS_FORMAT, 0, 0),
    }),
    /** `read` of a level asked before (`ask`), no string built. */
    readAsked: ({ id, address, size }: LevelAsk, failed: LevelFailed) =>
      readId(id, address, size, failed, 0, 0, always),
    /** Whether the read of `ask` failed for good: no request will be sent for it again. */
    failedForGood: ({ id }: LevelAsk) => failures.blocked(id)?.state === 'refused',
    /** Holds `asks` in the cache, landed or not, until `letGo`: no eviction takes them. */
    hold(asks: readonly LevelAsk[]) {
      for (const { id } of asks) store.acquire(id)
    },
    /** Lets `asks` held go (`hold`): they leave by last use from now on. */
    letGo(asks: readonly LevelAsk[]) {
      for (const { id } of asks) store.release(id)
      store.fit()
    },
    /** Bytes a level landing may take in the cache (`PageCache.roomBytes`). */
    get room() {
      return store.roomBytes
    },
    /** Tells `landed` each level that lands from now on; returns what stops it. */
    watch(landed: () => void) {
      watchers.add(landed)
      return () => void watchers.delete(landed)
    },
    get inFlight() {
      return pending.size
    },
    get fetched() {
      return fetched
    },
    /** Bytes the levels held take in the page cache, every cook's. */
    get bytes() {
      return store.levelBytes
    },
    /** Held when every in-flight read has succeeded or failed. */
    settled: () => Promise.all(pending.values()).then(() => undefined),
  }
}

export type HeldLevels = ReturnType<typeof createHeldLevels>

const made = new WeakMap<TextureLevelReader, HeldLevels>()

/** The one held-level read of `read`, tiles' and impostor atlases' alike: made on first use, gone
 *  with its reader. */
export function heldLevelsOf(read: TextureLevelReader) {
  let levels = made.get(read)
  if (!levels) made.set(read, (levels = createHeldLevels(read)))
  return levels
}
