/**
 * THE PAGES WHOSE DRAWING A WORLD SWITCH MOVED, for what the shadow maps hold over them: drawn from
 * the other representation (`shadowsFollowCells`, `../../../frame/prepare/lightResources.ts`).
 *
 * Every page of an actor its cell turned to draw or to hide — its cell's world ranks in its
 * instance —, and every page of a placement that turned to draw or to draw no more: its file shown
 * or hidden as its main cell, or its HLOD 0 cell turned to draw its placements or not
 * (`worldFiles.ts`, `worldFollow.ts`). A placement draws as `placementDraws` has it
 * (`worldLinks.ts`), compared with what it drew at the last walk; the placements
 * cost one walk of the links once any of their words moved.
 */
import type { PackedDag } from '../types.ts'
import {
  CELL_DRAW,
  LINK_WORDS,
  isUnlinked,
  placementDraws,
  type PackedWorld,
} from './worldLinks.ts'

/** Each cell's world ranks, its actor's pages. */
function ranksByCell({ cells, hlod }: PackedWorld) {
  const ranks: number[][] = Array.from({ length: cells }, () => [])
  hlod.forEach((cell, rank) => ranks[cell].push(rank))
  return ranks
}

/** The pages `packed`'s `world` switches moved, followed. */
export function createSwitchedPages(packed: PackedDag, world: PackedWorld) {
  const { links, roots, cells, rowsOf } = world
  const slots = links.length / LINK_WORDS
  /** Per cell slot, whether its actor's drawing moved since the last walk, and the slots so
   *  marked. */
  const actorMoved = new Uint8Array(cells * roots.length),
    actorSlots: number[] = []
  /** Each cell's world ranks, its actor's pages, and per placement slot whether it drew at the last
   *  walk: made at the first `take` — a cut whose shadows follow no cell never takes —, where
   *  only the placements in no cell and no file drew yet. */
  let ranksOf: number[][] | undefined, drew: Uint8Array | undefined
  /** Whether a placement's word moved since the last walk. */
  let placementsMoved = false
  return {
    /** Cell slot `at`'s word moved by the bits `moved` (`CELL_DRAW`): an actor that places rows
     *  moves them too. */
    cellMoved(at: number, moved: number) {
      if (moved & CELL_DRAW.placements || (moved & CELL_DRAW.hlod && rowsOf[at % cells]))
        placementsMoved = true
      if (!(moved & CELL_DRAW.hlod) || actorMoved[at]) return
      actorMoved[at] = 1
      actorSlots.push(at)
    },
    /** A file's word moved. */
    fileMoved() {
      placementsMoved = true
    },
    /** Each page whose drawing moved since the last call, told to `visit` by its placement and its
     *  rank there; a placement no longer linked draws, as one never linked. */
    take(visit: (w: number, rank: number) => void) {
      for (const at of actorSlots) {
        actorMoved[at] = 0
        const cell = at % cells,
          w = roots[(at - cell) / cells]
        for (const rank of (ranksOf ??= ranksByCell(world))[cell]) visit(w, rank)
      }
      actorSlots.length = 0
      if (!placementsMoved) return
      placementsMoved = false
      if (!drew) {
        drew = new Uint8Array(slots)
        for (let w = 0; w < slots; w++) drew[w] = isUnlinked(world, w) ? 1 : 0
      }
      const before = drew
      for (let w = 0; w < slots; w++) {
        const now = placementDraws(world, w) ? 1 : 0
        if (before[w] === now) continue
        before[w] = now
        for (let rank = 0; rank < packed.cutLinks[w].pageCount; rank++) visit(w, rank)
      }
    },
    /** Bytes of its host tables. */
    get hostBytes() {
      return actorMoved.byteLength + (drew?.byteLength ?? 0)
    },
  }
}
