import type { WebgpuTileAtlas } from './atlasTypes.ts'
import type { FeedbackHits, WebgpuTileFeedback } from './feedback.ts'
import type { TileKey } from './pageTable.ts'
import type { TileCounters } from './counters.ts'

/** A tile to serve: its atlas, its key and its weight; `asked` when the CPU named it (`ask`). */
export type TileRequest = { atlas: WebgpuTileAtlas; key: TileKey; weight: number; asked: boolean }

/** What a pass serves: the requests `from` to `to` of `list`, heaviest first. */
export type TileWanted = { readonly list: readonly TileRequest[]; from: number; to: number }

const byWeight = (a: TileRequest, b: TileRequest) => b.weight - a.weight

/**
 * What a pass has to serve: the tiles the last image feedback named, most looked-at first, or —
 * when no feedback has come back since — what the previous pass left unserved under its budget;
 * and beside them the tiles the CPU asked since the last pass (`ask`): those of a texture no pixel
 * reads yet — an impostor card drawn only once its maps reside (`cardTiles.ts`), whose pixels
 * therefore name nothing before. An ask holds for one pass: its asker names it again each image
 * while it waits, so a deferred ask is never served twice.
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
 * tile in place; the asks too, from one pass to the next.
 */
export function createTileRequests(options: {
  feedback: WebgpuTileFeedback
  color: WebgpuTileAtlas
  data: WebgpuTileAtlas
  counters: TileCounters
}) {
  const { feedback, color, data, counters } = options
  /** The requests of the last feedback and the records spare for a longer one; the asks since
   *  the last pass, `asks[0 .. askCount)`; what the pass serves, both merged and sorted. */
  const fed: TileRequest[] = [],
    spare: TileRequest[] = [],
    asks: TileRequest[] = [],
    list: TileRequest[] = []
  const wanted: TileWanted = { list, from: 0, to: 0 }
  let named = 0,
    askCount = 0,
    holdsAsks = false
  const record = (asked = false): TileRequest => ({
    atlas: color,
    key: { slot: 0, level: 0, tx: 0, ty: 0 },
    weight: 0,
    asked,
  })
  /** The pass's list: `kept[from .. to)` — the feedback's, or the last list itself, compacted in
   *  place, the asks it held left out: an ask holds for one pass —, then the asks since,
   *  heaviest first. */
  const merge = (kept: readonly TileRequest[], from: number, to: number) => {
    let count = 0
    for (let i = from; i < to; i++) if (!kept[i].asked) list[count++] = kept[i]
    for (let i = 0; i < askCount; i++) list[count++] = asks[i]
    list.length = count
    holdsAsks = askCount > 0
    askCount = 0
    list.sort(byWeight)
    wanted.from = 0
    wanted.to = count
  }
  /** Tiles the last image feedback names that do not reside. */
  const fromFeedback = (hits: FeedbackHits) => {
    let requested = 0,
      atLevel = 0,
      gap = 0,
      count = 0
    for (let i = 0; i < hits.count; i++) {
      const index = hits.index[i]
      const atlas = index < color.pages.entries ? color : data
      if (count === fed.length) fed.push(spare.pop() ?? record())
      const request = fed[count],
        { key } = request
      atlas.pages.tileOf(index, key)
      if (atlas.textures[key.slot].retired) continue
      requested++
      const served = atlas.servedLevel(key) - key.level
      if (served === 0) atLevel++
      gap += served
      if (atlas.resides(key)) continue
      request.atlas = atlas
      request.weight = hits.weight[i]
      count++
    }
    while (fed.length > count) spare.push(fed.pop()!)
    counters.requested = requested
    counters.atLevel = atLevel
    counters.missingAverage = requested ? gap / requested : 0
    merge(fed, 0, count)
  }
  return {
    reset: () => {
      wanted.from = wanted.to = 0
    },
    /** Asks the tile `key` of `atlas` for the next pass, at `weight`: one the CPU knows a texture
     *  waits for and no pixel names. The key is copied. */
    ask(atlas: WebgpuTileAtlas, key: TileKey, weight: number) {
      if (askCount === asks.length) asks.push(record(true))
      const request = asks[askCount++]
      request.atlas = atlas
      Object.assign(request.key, key)
      request.weight = weight
    },
    /** The requests a pass serves, in weight order, the asks since the last pass among them;
     *  none when nothing is named, deferred or asked. */
    take(frame: number): TileWanted {
      const hits = feedback.take()
      if (hits) {
        named = frame
        fromFeedback(hits)
      } else if (askCount || holdsAsks) merge(list, wanted.from, wanted.to)
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
