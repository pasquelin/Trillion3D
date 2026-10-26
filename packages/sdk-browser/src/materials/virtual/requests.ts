import type { WebgpuTileAtlas } from './atlas/atlasTypes.ts'
import type { FeedbackHits, WebgpuTileFeedback } from './feedback.ts'
import type { TileKey } from './page/pageTable.ts'
import type { TileCounters } from './counters.ts'
import { atlasKeyOf, tileId } from './ids.ts'

/** A tile to serve: its atlas, its key and its weight. */
export type TileRequest = { atlas: WebgpuTileAtlas; key: TileKey; weight: number }

/** What a pass serves: the requests `from` to `to` of `list`, heaviest first. */
export type TileWanted = { readonly list: readonly TileRequest[]; from: number; to: number }

/** The tiles a pass may take beside the feedback (`ask`). */
const TILES_ASKED = 64

const byWeight = (a: TileRequest, b: TileRequest) => b.weight - a.weight

const idOf = (atlas: WebgpuTileAtlas, key: TileKey) => atlasKeyOf(atlas.kind, tileId(key))

const newRecord = (atlas: WebgpuTileAtlas): TileRequest => ({
  atlas,
  key: { slot: 0, level: 0, tx: 0, ty: 0 },
  weight: 0,
})

/** The list of the requests the feedback names: the records reused from one feedback to the next,
 *  each fed the key of its tile in place, the tile ids that make one request of a tile asked
 *  twice, and the list the pass serves. */
function createRequestBook(color: WebgpuTileAtlas) {
  /** The requests of the last feedback and the records spare for a longer one; what the pass
   *  serves, sorted. */
  const fed: TileRequest[] = [],
    spare: TileRequest[] = [],
    list: TileRequest[] = []
  const wanted: TileWanted = { list, from: 0, to: 0 }
  /** The tiles of the last feedback by tile id: a tile asked twice — by pixels, and as the step
   *  toward a finer one — is one request with both counts. */
  const listed = new Map<number, TileRequest>()
  /** Requests listed in `fed` by the feedback being read. */
  let count = 0
  /** The record the next request is written in. */
  const spareRecord = () => {
    if (count === fed.length) fed.push(spare.pop() ?? newRecord(color))
    return fed[count]
  }
  /** Lists the tile of `request` unless already listed, adding its pixels either way; whether it
   *  was listed. */
  const enlist = (atlas: WebgpuTileAtlas, request: TileRequest, pixels: number) => {
    const id = idOf(atlas, request.key),
      known = listed.get(id)
    if (known) {
      known.weight += pixels
      return false
    }
    request.atlas = atlas
    request.weight = pixels
    listed.set(id, request)
    count++
    return true
  }
  return {
    wanted,
    spareRecord,
    enlist,
    /** A feedback is about to be read: nothing is listed. */
    begin() {
      count = 0
      listed.clear()
    },
    /** The feedback is read: the records past the ones listed go spare. */
    release() {
      while (fed.length > count) spare.push(fed.pop()!)
    },
    /** The pass's list: the feedback's `fed[0 .. count)` by priority, the pixels that named a tile
     *  times one more than its level: the coarser first, which the finer ones wait on. */
    merge() {
      for (let i = 0; i < count; i++) {
        const request = fed[i]
        request.weight *= 1 + request.key.level
        list[i] = request
      }
      list.length = count
      list.sort(byWeight)
      wanted.from = 0
      wanted.to = count
    },
  }
}

/** The tiles asked beside the feedback for an image they are not drawn in yet — an HLOD actor
 *  warming before its switch (`../../frame/prepare/hlodWarm.ts`) —: served after the feedback's,
 *  asked again each image while still wanted, let go once a pass is over. Each tile once a pass
 *  (`seen`, by atlas and tile id), at most `TILES_ASKED`: what a pass may take beside the
 *  feedback, never the room the image itself asks. The records are kept from pass to pass. */
function createAskedTiles(color: WebgpuTileAtlas) {
  const asked: TileRequest[] = [],
    seen = new Set<number>()
  let askedCount = 0
  return {
    /** Tile `key` of `atlas` asked for the next pass, beside the feedback; false once the pass
     *  takes no more. */
    ask(atlas: WebgpuTileAtlas, key: TileKey) {
      if (askedCount >= TILES_ASKED) return false
      const id = idOf(atlas, key)
      if (seen.has(id)) return true
      seen.add(id)
      if (askedCount === asked.length) asked.push(newRecord(color))
      const request = asked[askedCount++]
      request.atlas = atlas
      Object.assign(request.key, key)
      return true
    },
    /** How many tiles were asked beside the feedback since the last pass (`ask`), in `asked`. */
    get askedCount() {
      return askedCount
    },
    asked: asked as readonly TileRequest[],
    /** A pass is over: what it asked beside the feedback is let go. */
    clearAsked() {
      askedCount = 0
      seen.clear()
    },
  }
}

/** The reader of the last image feedback: the tiles it names that do not reside, each with its
 *  step toward a finer level, listed in `book`. */
function createFeedbackReader(
  color: WebgpuTileAtlas,
  data: WebgpuTileAtlas,
  counters: TileCounters,
  book: ReturnType<typeof createRequestBook>,
  coverage: ReadonlyMap<WebgpuTileAtlas, Map<number, number>>,
) {
  /** For the tile `key` the pool serves at level `served`, three levels coarser or more, the tile
   *  two levels finer than the one it serves, asked with the same `pixels`: a level that loads
   *  sooner than the one asked and shows in between. */
  const enlistAhead = (atlas: WebgpuTileAtlas, key: TileKey, served: number, pixels: number) => {
    const { across, down, tail } = atlas.textures[key.slot].layout,
      ahead = served - 2
    if (ahead <= key.level || ahead >= tail) return
    const shift = ahead - key.level,
      next = book.spareRecord(),
      into = next.key
    into.slot = key.slot
    into.level = ahead
    into.tx = key.tx >> shift
    into.ty = key.ty >> shift
    if (into.tx < across[ahead] && into.ty < down[ahead] && !atlas.resides(into))
      book.enlist(atlas, next, pixels)
  }
  /** Tiles the last image feedback names that do not reside, each with its step toward a finer
   *  level (`enlistAhead`). */
  const fromFeedback = (hits: FeedbackHits) => {
    let requested = 0,
      atLevel = 0,
      gap = 0
    book.begin()
    for (const covered of coverage.values()) covered.clear()
    for (let i = 0; i < hits.count; i++) {
      const index = hits.index[i]
      const atlas = index < color.pages.entries ? color : data
      const request = book.spareRecord(),
        { key } = request
      atlas.pages.tileOf(index, key)
      if (atlas.textures[key.slot].retired) continue
      const covered = coverage.get(atlas)!
      covered.set(key.slot, (covered.get(key.slot) ?? 0) + hits.weight[i])
      requested++
      const served = atlas.servedLevel(key)
      if (served === key.level) atLevel++
      gap += served - key.level
      if (atlas.resides(key)) continue
      if (book.enlist(atlas, request, hits.weight[i]))
        enlistAhead(atlas, key, served, hits.weight[i])
    }
    book.release()
    counters.requested = requested
    counters.atLevel = atLevel
    counters.missingAverage = requested ? gap / requested : 0
    book.merge()
  }
  return fromFeedback
}

/**
 * What a pass has to serve: the tiles the last image feedback named, most looked-at first, or —
 * when no feedback has come back since — what the previous pass left unserved under its budget.
 *
 * A budget defers tiles, it never drops them: the remainder of a pass is kept in weight order and
 * offered again to the next pass, until fresh feedback replaces it. Fresh feedback always wins,
 * since it names what the image looks at now; a deferred tile still looked at is named again
 * within a feedback cycle, one no longer looked at would be work for nothing. A replay keeps the
 * frame of the feedback that named them (`frame`). Which tile gives its place is the GPU's word:
 * the pixels stamp the places they read, the ancestor of a streaming tile included
 * (`stampWgsl.ts`).
 *
 * The feedback lists the tiles asked and nothing else (`feedback.ts`): a feedback costs the tiles
 * it names. The requests are records reused from one feedback to the next, each fed the key of its
 * tile in place.
 */
export function createTileRequests(options: {
  feedback: WebgpuTileFeedback
  color: WebgpuTileAtlas
  data: WebgpuTileAtlas
  counters: TileCounters
}) {
  const { feedback, color, data, counters } = options
  const book = createRequestBook(color),
    { wanted } = book
  let named = 0
  /** The pixels each texture of an atlas filled in the last feedback, by slot: how much the view looks at it. */
  const coverage = new Map<WebgpuTileAtlas, Map<number, number>>([
    [color, new Map()],
    [data, new Map()],
  ])
  const fromFeedback = createFeedbackReader(color, data, counters, book, coverage)
  const beside = createAskedTiles(color)
  return {
    reset: () => {
      wanted.from = wanted.to = 0
    },
    ask: beside.ask,
    /** The pixels each texture of `atlas` filled in the last feedback, by slot. */
    coverageOf: (atlas: WebgpuTileAtlas): ReadonlyMap<number, number> => coverage.get(atlas)!,
    get askedCount() {
      return beside.askedCount
    },
    asked: beside.asked,
    clearAsked: beside.clearAsked,
    /** The requests a pass serves, in weight order; none when nothing is named or deferred. */
    take(frame: number): TileWanted {
      const hits = feedback.take()
      if (hits) {
        named = frame
        fromFeedback(hits)
      }
      return wanted
    },
    /** Frame of the feedback the list came from: where a pass places what it serves. */
    get frame() {
      return named
    },
    /** What the pass did not reach, from request `from` of its list: offered again to the next
     *  pass. */
    defer(from: number) {
      wanted.from = Math.min(from, wanted.to)
    },
    /** Tiles the list still offers: once a pass told what it reached (`defer`), those its budget
     *  deferred to the next; before, the whole list it is offered. */
    get deferred() {
      return wanted.to - wanted.from
    },
  }
}
