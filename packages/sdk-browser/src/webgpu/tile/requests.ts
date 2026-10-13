import type { WebgpuTileAtlas } from './atlas.ts'
import type { FeedbackHits, WebgpuTileFeedback } from './feedback.ts'
import type { TileKey } from './pageTable.ts'
import type { TileCounters } from './counters.ts'

export type TileRequest = { atlas: WebgpuTileAtlas; key: TileKey; weight: number }

/** What a pass serves: the requests `from` to `to` of `list`, heaviest first. */
export type TileWanted = { readonly list: readonly TileRequest[]; from: number; to: number }

const byWeight = (a: TileRequest, b: TileRequest) => b.weight - a.weight

/**
 * What a pass has to serve: the tiles the last image feedback named, most looked-at first, or —
 * when no feedback has come back since — what the previous pass left unserved under its budget.
 *
 * A budget defers tiles, it never drops them: the remainder of a pass is kept in weight order and
 * offered again to the next pass, until fresh feedback replaces it. Fresh feedback always wins,
 * since it names what the image looks at now; a deferred tile still looked at is named again
 * within a feedback cycle, one no longer looked at would be work for nothing. A replay places its
 * tiles at the frame of the feedback that named them (`frame`): the pool then yields exactly what
 * that pass would have yielded, never a tile a later image has looked at.
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
  /** The requests of the last feedback, sorted, and the records spare for a longer one. */
  const list: TileRequest[] = [],
    spare: TileRequest[] = []
  const wanted: TileWanted = { list, from: 0, to: 0 }
  let named = 0
  const record = (): TileRequest => ({
    atlas: color,
    key: { slot: 0, level: 0, tx: 0, ty: 0 },
    weight: 0,
  })
  /** Tiles the last image feedback names, resident ones touched along the way. */
  const fromFeedback = (hits: FeedbackHits, frame: number) => {
    let requested = 0,
      atLevel = 0,
      gap = 0,
      count = 0
    for (let i = 0; i < hits.count; i++) {
      const index = hits.index[i]
      const atlas = index < color.pages.entries ? color : data
      if (count === list.length) list.push(spare.pop() ?? record())
      const request = list[count],
        { key } = request
      atlas.pages.tileOf(index, key)
      if (atlas.textures[key.slot].retired) continue
      requested++
      const served = atlas.servedLevel(key) - key.level
      if (served === 0) atLevel++
      gap += served
      if (atlas.touch(key, frame)) continue
      request.atlas = atlas
      request.weight = hits.weight[i]
      count++
    }
    while (list.length > count) spare.push(list.pop()!)
    counters.requested = requested
    counters.atLevel = atLevel
    counters.missingAverage = requested ? gap / requested : 0
    list.sort(byWeight)
    wanted.from = 0
    wanted.to = count
  }
  return {
    reset: () => {
      wanted.from = wanted.to = 0
    },
    /** The requests a pass serves, in weight order; none when nothing is named or deferred. */
    take(frame: number): TileWanted {
      const hits = feedback.take()
      if (!hits) return wanted
      named = frame
      fromFeedback(hits, frame)
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
