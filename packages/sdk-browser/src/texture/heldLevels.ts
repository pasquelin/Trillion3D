/**
 * THE ONE READ OF A HELD LEVEL: the cooked levels and block tile records a session cuts its tiles
 * from, read through its level reader and held among the page cache's entries under the reader's
 * cook (`TextureLevelReader.store`, `streaming/pageCache.ts`), within its one budget, the least
 * recently read leaving first. That is the chain's only host memory, and it does not depend on
 * the scene.
 *
 * A tile is read alone, its record by one HTTP Range (`levelReader.ts`, `tileRecords.ts`) — as
 * blocks, or decoded to RGBA8 for the lossless lane —, its length checked. A read is asked only
 * when it fits in what eviction can free beside the reads in flight (`PageCache.roomBytes`); one
 * that cannot fit at all is refused, its tile served by its coarse level until room comes back. An
 * in-flight read is never doubled.
 *
 * A read that fails is reported to the asker that launched it, and the record it read is held back
 * by the one failure policy (`streaming/failures.ts`), which says when it is asked again, if ever;
 * a record answered short or foreign is refused for good. Its tile stays served by its coarse level
 * meanwhile. The failures live with the reader, one per record asked at most.
 *
 * The reads in flight and the room they hold are the store's, every reader's (`flightOf`): a
 * session drawing the textures of several caches reads them all through its one page cache, within
 * one bound of reads and one room, however many cooks it reads.
 */
import {
  tileLevelBytes,
  type TextureLevel,
  type TextureLevelAddress,
  type TextureLevelReader,
  type TextureLevelStore,
} from './levelReader.ts'
import { createReadFailures } from '../streaming/failures.ts'
import { retriableError } from '../cluster/checked.ts'
import { tileRecord } from './tileRecords.ts'

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

/** Cooked-level reads in flight at most: beyond that, a level waits for the next image. */
const MAX_LEVEL_READS = 6
const always = () => true

/** What the level `address` names is read under for the cook `cook`: the format and the decoding
 *  are in it — a session that changes family mid-life reads the other file, or the same decoded. */
const levelKey = (cook: string, { sha256, atlas, level, format, rgba }: TextureLevelAddress) =>
  `${cook}/${sha256}/${atlas}/${level}/${format}${rgba ? '/rgba' : ''}`
/** What tile `tx`, `ty` of a level is held under, one string a tile asks. */
const tileKey = (level: string, tx: number, ty: number) => `${level}/${tx},${ty}`

/** The reads in flight of one store, every reader's, and the bytes they will hold once landed. */
type Flight = { pending: Map<string, Promise<void>>; reading: number }
const flights = new WeakMap<TextureLevelStore, Flight>()
/** The one flight of `store`: made on first use, gone with the store. */
function flightOf(store: TextureLevelStore) {
  let flight = flights.get(store)
  if (!flight) flights.set(store, (flight = { pending: new Map(), reading: 0 }))
  return flight
}

function createHeldLevels(read: TextureLevelReader) {
  const { store, key } = read,
    flight = flightOf(store),
    { pending } = flight,
    failures = createReadFailures({
      retriable: (error) => !(error instanceof LevelBytesError) && retriableError(error),
    })
  let fetched = 0
  /** Each level's key under this reader's cook (`levelKey`), by its address: made once a level
   *  whose address is kept (`webgpu/tile/serveTile.ts`). */
  const levelIds = new WeakMap<TextureLevelAddress, string>()
  const levelIdOf = (address: TextureLevelAddress) => {
    let id = levelIds.get(address)
    if (id === undefined) levelIds.set(address, (id = levelKey(key, address)))
    return id
  }
  /** Runs `land`, a read that holds what it brings, under `id`, `bytes` once landed; a failure told
   *  `failed` about `address`. */
  const launch = (
    id: string,
    address: TextureLevelAddress,
    bytes: number,
    failed: LevelFailed,
    land: () => Promise<void>,
  ) => {
    flight.reading += bytes
    const landing = land()
      .then(() => {
        failures.passed(id)
        fetched++
      })
      .catch((error: unknown) => {
        failures.record(id, error)
        failed(address, error)
      })
      .finally(() => {
        pending.delete(id)
        flight.reading -= bytes
      })
    pending.set(id, landing)
  }
  /** Holds `level` under `id` once its length is the `bytes` its record implies. */
  const keep = (id: string, level: TextureLevel, bytes: number, size: Size) => {
    if (level.byteLength !== bytes) throw new LevelBytesError(size, level.byteLength)
    store.keepLevel(id, level)
  }
  /** `read` of tile `tx`, `ty`: its record alone. */
  const readTile = (
    address: TextureLevelAddress,
    size: Size,
    failed: LevelFailed,
    tx: number,
    ty: number,
    roomFor: () => boolean,
  ): TextureLevel | 'waiting' | 'refused' => {
    const id = tileKey(levelIdOf(address), tx, ty)
    const held = store.level(id)
    if (held) return held
    if (!roomFor()) return 'refused'
    if (pending.has(id) || failures.blocked(id) || pending.size >= MAX_LEVEL_READS) return 'waiting'
    // The record is reckoned where it is needed: a waiting tile asks every frame.
    const bytes = tileLevelBytes(tileRecord(...size, tx, ty).bytes, address.rgba),
      room = store.roomBytes
    if (bytes > room) return 'refused'
    // The reads in flight hold their room: one that fits only once they have landed waits for
    // them, rather than landing to evict a level read for a tile not cut yet.
    if (flight.reading + bytes > room) return 'waiting'
    launch(id, address, bytes, failed, async () =>
      keep(id, await read({ ...address, size, tx, ty }), bytes, size),
    )
    return 'waiting'
  }
  return {
    /**
     * What a tile is cut from — the block tile `tx`, `ty`'s record of the level `address` names,
     * as blocks or decoded — marked read, the level `size` texels wide and high; otherwise
     * `waiting` while its read is asked — launched here when none is in flight or held back, its
     * failure told `failed` — and `refused` when `roomFor` says the caller has no place for it, or
     * it cannot fit at all: nothing will come until room comes back, and nothing was read.
     */
    read(
      address: TextureLevelAddress,
      size: Size,
      failed: LevelFailed,
      tx = 0,
      ty = 0,
      roomFor: () => boolean = always,
    ) {
      return readTile(address, size, failed, tx, ty, roomFor)
    },
    /** Reads in flight in its store, every reader's. */
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
    /** Held when every read in flight in its store has succeeded or failed. */
    settled: () => Promise.all(pending.values()).then(() => undefined),
  }
}

export type HeldLevels = ReturnType<typeof createHeldLevels>

const made = new WeakMap<TextureLevelReader, HeldLevels>()

/** The one held-level read of `read`, every tile's: made on first use, gone with its reader. */
export function heldLevelsOf(read: TextureLevelReader) {
  let levels = made.get(read)
  if (!levels) made.set(read, (levels = createHeldLevels(read)))
  return levels
}
