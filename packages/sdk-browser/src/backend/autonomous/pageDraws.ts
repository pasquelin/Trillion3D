/**
 * The per-instance draw state of the WebGL2 autonomous backend, keyed by packed index:
 * what a placement's copy of a page owns — its geometry, its host mesh, whether it is attached to
 * the scene, the surface it wears and the last material-class change it followed. A `PageRec`
 * carries none of it, so one record per primitive can serve every placement. The layout
 * posts one draw per (placement, page), carried from one layout to the next by the ROOT it belongs
 * to; the catalogue resolves a packed rank back to its record, and `placement` to its root.
 */
import { createPageCatalogue, type PageCatalogue } from '../../page/selection/catalogue.ts'
import { postPackedBases, type PlacementIndex } from '../../page/selection/placements.ts'
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts'
import type { HostMaterials, HostMesh } from '../../host/resources.ts'
import type { ClusterRoot, PageRec } from '../../page/selection/types.ts'

export type PageDraw = {
  /** The record this state belongs to: an accessor checks it, as the catalogue does. */
  readonly page: PageRec
  geometry?: Geometry
  mesh?: HostMesh
  attached: boolean
  material?: HostMaterials
  /** The last material-class change this instance followed (`classPages.ts`). */
  turn: number
}

export type PageDraws = ReturnType<typeof createPageDraws>

/** A new instance's state: blank, or wearing what `sibling` — another instance of the same record —
 * wears, since every instance of a page draws one geometry and one surface. */
const blank = (page: PageRec, sibling?: PageDraw): PageDraw => ({
  page,
  attached: false,
  turn: sibling?.turn ?? 0,
  geometry: sibling?.geometry,
  material: sibling?.material,
})

export function createPageDraws(roots: readonly ClusterRoot<PageRec>[] = []) {
  let pages: PageRec[] = [],
    draws: PageDraw[] = [],
    catalogue: PageCatalogue = createPageCatalogue(pages)
  /** The per-placement tables: one object for the session, rewritten in place at each layout, so a
   *  reader built once — the pool's parents, the held residency — never reads a stale one. Empty
   *  until the first `layOut` below fills it. */
  const placement: PlacementIndex = {
    baseOfRoot: new Int32Array(0),
    rootOfPacked: new Int32Array(0),
  }
  /** The packed ranks of each record's instances, in packed order: its first names the page. */
  let ranks = new Map<PageRec, number[]>()
  /** The roots of the last layout, by rank: a root's draws are carried from the packed base that
   * layout posted on it (`packedBase`), one pointer per root and no table per instance. */
  let laidOut: readonly ClusterRoot<PageRec>[] = []

  /** The rank `root` held in the last layout, or -1: read from the packed base it carries, checked
   *  against that layout's own tables. Only this table posts the bases of these roots, so a root of
   *  the last layout always passes; a grown or instanced copy carries its template's base and fails. */
  const formerRank = (root: ClusterRoot<PageRec>) => {
    const rank = placement.rootOfPacked[root.packedBase ?? -1] ?? -1
    return laidOut[rank] === root ? rank : -1
  }
  /** The draw `root` carried for page `p`, record `rec`, in the last layout: its own instance, never
   *  another root's. Same position first — a root keeps its page order —, else its range is scanned. */
  const carriedDraw = (rank: number, p: number, rec: PageRec) => {
    const base = placement.baseOfRoot[rank],
      end = rank + 1 < laidOut.length ? placement.baseOfRoot[rank + 1] : draws.length
    if (base + p < end && draws[base + p].page === rec) return draws[base + p]
    for (let packed = base; packed < end; packed++)
      if (draws[packed].page === rec) return draws[packed]
    return undefined
  }

  /** Lays `roots` out: one packed rank per (placement, page), the catalogue over the packed order,
   *  and each instance's draw state carried from the root it belonged to; a new instance wears what
   *  the record's first instance wore, else starts blank. */
  function layOut(next: readonly ClusterRoot<PageRec>[]) {
    const nextPages: PageRec[] = [],
      nextDraws: PageDraw[] = [],
      nextRanks = new Map<PageRec, number[]>()
    // Pass 1: the draw a root it is already known by carries, by record.
    const carried: (PageDraw | undefined)[][] = [],
      assigned = new Set<PageRec>()
    for (const root of next) {
      const rank = formerRank(root),
        row: (PageDraw | undefined)[] = []
      for (let p = 0; p < root.pages.length; p++) {
        const rec = root.pages[p],
          draw = rank < 0 ? undefined : carriedDraw(rank, p, rec)
        if (draw) assigned.add(rec)
        row.push(draw)
      }
      carried.push(row)
    }
    // Pass 2: a root without one reclaims a single-instance record's draw, never one already taken:
    // a re-layout that recreates the root object — a synthetic layout — carries it this way.
    for (let r = 0; r < next.length; r++) {
      const root = next[r]
      for (let p = 0; p < root.pages.length; p++) {
        const rec = root.pages[p]
        let draw = carried[r][p]
        const before = ranks.get(rec)
        if (!draw && before?.length === 1 && !assigned.has(rec)) {
          draw = draws[before[0]]
          assigned.add(rec)
        }
        if (!draw) draw = blank(rec, before && draws[before[0]])
        const own = nextRanks.get(rec)
        if (own) own.push(nextPages.length)
        else nextRanks.set(rec, [nextPages.length])
        nextPages.push(rec)
        nextDraws.push(draw)
      }
    }
    pages = nextPages
    draws = nextDraws
    ranks = nextRanks
    laidOut = next.slice()
    postPackedBases(next, placement)
    catalogue = createPageCatalogue(pages)
  }
  layOut(roots)

  /** The state of packed rank `packed`, which must be laid out: every writer goes through this. */
  const at = (packed: number): PageDraw | undefined => draws[packed]
  /** The FIRST instance of `rec`: a per-page reader uses this; a per-instance one uses `at`. */
  const find = (rec: PageRec): PageDraw | undefined => {
    const packed = ranks.get(rec)?.[0]
    return packed === undefined ? undefined : draws[packed]
  }
  /** The state of `rec`'s first instance, which must be laid out. */
  const drawing = (rec: PageRec): PageDraw => {
    const draw = find(rec)
    if (!draw) throw new Error('PAGE_DRAW_MISSING')
    return draw
  }
  return {
    get pages(): readonly PageRec[] {
      return pages
    },
    /** The packed rank of `rec`'s first instance, or -1: a per-page lookup, not per-instance. */
    firstPacked: (rec: PageRec) => ranks.get(rec)?.[0] ?? -1,
    /** The root rank of `rec`'s first instance, or -1: a per-page lookup, for a per-page property. */
    rootRankOf: (rec: PageRec) => {
      const packed = ranks.get(rec)?.[0]
      return packed === undefined ? -1 : (placement.rootOfPacked[packed] ?? -1)
    },
    /** The per-placement tables: the same object across layouts, rewritten in place. */
    placement,
    layOut,
    at,
    find,
    drawing,
    geometryOf: (rec: PageRec) => find(rec)?.geometry,
    materialOf: (rec: PageRec) => find(rec)?.material,
    /** What a consumer resolves the cut's packed ranks through (`recordOf`). */
    recordOf: (packed: number) => catalogue.recordOf(packed),
    /** Runs `visit` on the packed rank of every instance of `rec`: a shared page's roots all hear
     *  of a change to the page's bytes or array. */
    forEachRank(rec: PageRec, visit: (packed: number) => void) {
      for (const packed of ranks.get(rec) ?? []) visit(packed)
    },
    /** Runs `visit` on the state of every instance of `rec`: what a page's bytes, surface or release
     *  change reaches every placement that draws it. */
    forEachDraw(rec: PageRec, visit: (draw: PageDraw, packed: number) => void) {
      for (const packed of ranks.get(rec) ?? []) visit(draws[packed], packed)
    },
    /** How many instances of `rec` the layout holds. */
    instances: (rec: PageRec) => ranks.get(rec)?.length ?? 0,
    /** Gives back what every instance of `rec` that left the scene owned, before its state drops. */
    forget(rec: PageRec) {
      for (const packed of ranks.get(rec) ?? []) {
        const draw = draws[packed]
        draw.geometry = draw.mesh = undefined
        draw.material = undefined
        draw.attached = false
      }
    },
  }
}
