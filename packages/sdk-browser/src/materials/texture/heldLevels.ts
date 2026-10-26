/**
 * THE ONE READ OF A HELD LEVEL: the cooked levels and block tile records a session cuts its tiles
 * from, read through its level reader and held among the page cache's entries under the reader's
 * cook (`TextureLevelReader.store`, `geometry/streaming/pageCache.ts`), within its one budget, the least
 * recently read leaving first. That is the chain's only host memory, and it does not depend on
 * the scene.
 *
 * A tile is read alone, its record by one HTTP Range (`levelReader.ts`, `tileRecords.ts`) — as
 * blocks, or decoded to RGBA8 for the lossless lane —, its length checked. A read is asked only
 * when it fits in what eviction can free beside the reads in flight (`PageCache.roomBytes`); one
 * that cannot fit at all is refused, its tile served by its coarse level until room comes back. An
 * in-flight read is never doubled.
 *
 * A read that fails is reported to the asker that launched it, at the first failure of a row and
 * when it is given up, and the record it read is asked again by the next frame that wants its tile,
 * with no wait unless its server asked one (`Retry-After`), whatever the failure of the read — a
 * missing file (a 404), a refusal (a 403), a server error, the network, a record whose bytes are not
 * those it implies (`LevelBytesError`) —, `streamingNumRetries` times (a negative count: without
 * end); after the last it is given up, and the record is not asked again. Its tile stays served by
 * its coarse level meanwhile (`geometry/streaming/failures.ts`, the one policy of the page
 * streamer's reads too). The failures live with the reader, one per record asked at most, till the
 * record is read.
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
import { createReadFailures } from '../../geometry/streaming/failures.ts'
import { tileRecord } from './tileRecords.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { TILE_SIZE } from '../../../../sdk-core/src/contracts/writtenFormats.ts'

/** Block bytes that are not the whole blocks their dimensions imply: a tile's record answered
 *  short or foreign, or a tail level (`materials/virtual/writeBlocks.ts`). */
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
const levelKey = (
  cook: string,
  { sha256, atlas, level, format, rgba, texels }: TextureLevelAddress,
) =>
  `${cook}/${sha256}/${atlas}/${level}/${format}${rgba ? '/rgba' : ''}${texels ? `/${texels}` : ''}`

/** The reads in flight of one store, every reader's, and the bytes they will hold once landed. */
type Flight = { pending: Map<string, Promise<void>>; reading: number }
const flights = new WeakMap<TextureLevelStore, Flight>()
/** The one flight of `store`: made on first use, gone with the store. */
function flightOf(store: TextureLevelStore) {
  let flight = flights.get(store)
  if (!flight) flights.set(store, (flight = { pending: new Map(), reading: 0 }))
  return flight
}

/** The launches of one reader's level reads over the store's `flight`: `launch` runs `land`, a read
 *  that holds what it brings, under `id`, `bytes` once landed; a failure told `failed` about
 *  `address` when it is its key's first in a row. The failures and the count of reads landed are
 *  the reader's. */
function createLaunches(flight: Flight, retries: TextureLevelReader['retries']) {
  const failures = createReadFailures({ retries }),
    counts = { fetched: 0 }
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
        counts.fetched++
      })
      .catch((error: unknown) => {
        const { first, again } = failures.record(id, error)
        if (first || !again) failed(address, error)
      })
      .finally(() => {
        flight.pending.delete(id)
        flight.reading -= bytes
      })
    flight.pending.set(id, landing)
  }
  return { launch, failures, counts }
}

/** Each level's key under the cook `cook` (`levelKey`), by its address: made once a level whose
 *  address is kept (`materials/virtual/serveTile.ts`). */
function createLevelIds(cook: string) {
  const ids = new WeakMap<TextureLevelAddress, string>()
  return (address: TextureLevelAddress) => {
    let id = ids.get(address)
    if (id === undefined) ids.set(address, (id = levelKey(cook, address)))
    return id
  }
}

/** What tile `tx`, `ty` of a level is held under, made once for each tile a level has (a waiting
 *  tile asks every frame): its level's key and its place in the level. */
function createTileIds(levelIdOf: ReturnType<typeof createLevelIds>) {
  const ids = new WeakMap<TextureLevelAddress, Map<number, string>>()
  return (address: TextureLevelAddress, [width]: Size, tx: number, ty: number) => {
    let tiles = ids.get(address)
    if (!tiles) ids.set(address, (tiles = new Map()))
    const at = ty * ceilDiv(width, TILE_SIZE) + tx
    let id = tiles.get(at)
    if (id === undefined) tiles.set(at, (id = `${levelIdOf(address)}/${tx},${ty}`))
    return id
  }
}

/** What a reader's tile reads work over: its read, its store and the store's flight, its launches
 *  and its level keys. */
type TileReads = {
  read: TextureLevelReader
  store: TextureLevelStore
  flight: Flight
  launches: ReturnType<typeof createLaunches>
  tileIdOf: ReturnType<typeof createTileIds>
}

/** `read` of tile `tx`, `ty`: its record alone, held under `id` once its length is the `bytes`
 *  its record implies. */
function readTile(
  { read, store, flight, launches, tileIdOf }: TileReads,
  address: TextureLevelAddress,
  size: Size,
  failed: LevelFailed,
  tx: number,
  ty: number,
  roomFor: () => boolean,
): TextureLevel | 'waiting' | 'refused' {
  const id = tileIdOf(address, size, tx, ty)
  const held = store.level(id)
  if (held) return held
  if (!roomFor()) return 'refused'
  const busy = flight.pending.has(id) || launches.failures.blocked(id)
  if (busy || flight.pending.size >= MAX_LEVEL_READS) return 'waiting'
  // The record is reckoned where it is needed: a waiting tile asks every frame.
  const bytes = tileLevelBytes(tileRecord(...size, tx, ty, address.format).bytes, address),
    room = store.roomBytes
  if (bytes > room) return 'refused'
  // The reads in flight hold their room: one that fits only once they have landed waits for
  // them, rather than landing to evict a level read for a tile not cut yet.
  if (flight.reading + bytes > room) return 'waiting'
  launches.launch(id, address, bytes, failed, async () => {
    const level = await read({ ...address, size, tx, ty })
    if (level.byteLength !== bytes) throw new LevelBytesError(size, level.byteLength)
    store.keepLevel(id, level)
  })
  return 'waiting'
}

function createHeldLevels(read: TextureLevelReader) {
  const { store, key } = read,
    flight = flightOf(store),
    launches = createLaunches(flight, read.retries),
    reads: TileReads = {
      ...{ read, store, flight, launches },
      tileIdOf: createTileIds(createLevelIds(key)),
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
      return readTile(reads, address, size, failed, tx, ty, roomFor)
    },
    /** Reads in flight in its store, every reader's. */
    get inFlight() {
      return flight.pending.size
    },
    get fetched() {
      return launches.counts.fetched
    },
    /** Bytes the levels held take in the page cache, every cook's. */
    get bytes() {
      return store.levelBytes
    },
    /** Held when every read in flight in its store has succeeded or failed. */
    settled: () => Promise.all(flight.pending.values()).then(() => undefined),
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
