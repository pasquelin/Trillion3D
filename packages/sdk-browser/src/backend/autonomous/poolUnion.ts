import { type WebglViewState } from './viewKeys.ts'

/** A page as the pool charges it: its URL, and its DAG level, which ranks a union of views. */
export type Ranked = { readonly url: string; readonly level?: number }

/**
 * The WebGL2 pool's admission when several views ask (`pool.ts`, `views.ts`): the drawn view's
 * requests and the other views' charged in one ranking, coarsest first as each list is, the drawn
 * view's first on a tie, each page once, so a page two views share fills its slots once. Where
 * the slots fill, every list keeps what came before: the other views' requests are cut there, and
 * how many of the drawn view's fit is returned. The union asked for is never more than the one
 * budget. Its tables are allocated once, and grow with the number of views only.
 *
 * While a capture is drawn, its requests are ranked first, each lifted above every level of the
 * union (`first`): the capture keeps what it kept alone under the one budget, and the other views'
 * requests take what room is left, as WebGPU's queue does (`../../webgpu/residency/
 * requestAdmission.ts`, #268). A persistent view and the main one rank the union.
 */
export function createUnionFit(
  /** Each page's share of the slots, by URL (`poolDraw.ts`). */
  shares: ReadonlyMap<string, number>,
  others: readonly Pick<WebglViewState, 'requested'>[],
) {
  const lists: (readonly Ranked[])[] = [],
    cursors: number[] = [],
    ends: number[] = [],
    charged = new Set<string>()
  /** Added to the drawn view's levels: a capture's are filed above the union's (`fit`). */
  let lift = 0
  /** The list whose next page is the coarsest, the first on a tie; -1 once all are walked. */
  const coarsest = () => {
    let pick = -1,
      level = -Infinity
    for (let l = 0; l < lists.length; l++) {
      const rec = lists[l][cursors[l]]
      const at = rec ? (rec.level ?? 0) + (l ? 0 : lift) : -Infinity
      if (at <= level) continue
      pick = l
      level = at
    }
    return pick
  }
  const union = {
    /** The slots the whole union charges, the root cover's included, as of the last `fit`. */
    used: 0,
    /** Charges the union against `room` slots, `used` already taken by the root cover; returns how
     *  many of `requested` fit. `first`: the drawn view is a capture, ranked before the union. */
    fit(requested: readonly Ranked[], room: number, used: number, first = false) {
      lift = first ? Infinity : 0
      lists.length = cursors.length = ends.length = 0
      for (let l = -1; l < others.length; l++) {
        const list = l < 0 ? requested : others[l].requested
        lists.push(list)
        cursors.push(0)
        ends.push(list.length)
      }
      charged.clear()
      let full = false
      for (let pick = coarsest(); pick >= 0; pick = coarsest()) {
        const { url } = lists[pick][cursors[pick]++]
        if (charged.has(url)) continue
        charged.add(url)
        used += shares.get(url) ?? 0
        if (full || used <= room) continue
        full = true
        for (let l = 0; l < lists.length; l++) ends[l] = cursors[l] - (l === pick ? 1 : 0)
      }
      for (let l = 1; l < lists.length; l++) others[l - 1].requested.length = ends[l]
      union.used = used
      return ends[0]
    },
  }
  return union
}
