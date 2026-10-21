/**
 * THE WARM-UPS THE WORLD'S SWITCHES WAIT ON (`worldFollow.ts`).
 *
 * A switch that draws an HLOD actor whose layer asks a warm-up (`CHAIN_ACTOR.warmup`) asks the
 * warm-up it is given (`ActorWarmth`, `../../../frame/prepare/hlodWarm.ts`) whether the actor still
 * needs a frame: while it does, the switch waits, asked again at each cut. The actor drawn or let
 * go, its warm-up ends (`release`). No switch waits on one with no warm-up given, during the
 * initial load — till the first image is shown (`firstImageShown`) —, while a load blocks on slow
 * streaming (`blockingLoad`), as the reference warms nothing for a blocking load, or while the
 * HLOD actors are off (`hlodEnabled`).
 */
import { CHAIN_ACTOR } from '../../../../../sdk-core/src/manifest/worldRoots.ts'

/** The warm-up a switch that draws an HLOD actor waits on: whether the actor of cell `actor` of
 *  `instance`, about to draw as cell `cell` switches — the cell it lies in turning visible, or the
 *  cell it stands for turning invisible —, still needs a frame of warm-up. Asked once a frame while
 *  the switch waits; a frame passed unasked starts its count again. The actor drawn or let go, its
 *  warm-up ends (`release`). */
export type ActorWarmth = {
  warming(instance: number, actor: number, cell: number): boolean
  release(instance: number, actor: number): void
}

/** The warm-ups the switches of a world of `cells` HLOD cells wait on, its actors' flags `actor`
 *  (`CHAIN_ACTOR`). */
export function createSwitchWarmth(actor: Uint8Array, cells: number) {
  /** The warm-up given; whether the initial load runs, a load blocks, the HLOD actors are off; and
   *  the cell slots whose switch waits on a warm-up. */
  let warmth: ActorWarmth | undefined,
    initial = true,
    blocking = false,
    off = false
  const waiting = new Set<number>()
  return {
    /** Whether the actor of cell `drawn` at `base`, about to draw as cell `cell` switches, is warmed
     *  up — one whose layer asks none always is —; else the switch of slot `asker` waits for it. */
    ready(base: number, drawn: number, cell: number, asker: number) {
      if (!warmth || initial || blocking || off) return true
      if ((actor[drawn] & CHAIN_ACTOR.warmup) === 0) return true
      if (!warmth.warming(base / cells, drawn, cell)) return true
      waiting.add(asker)
      return false
    },
    /** The actor of cell `cell` at `base` drawn or let go: its warm-up ends. */
    release(base: number, cell: number) {
      warmth?.release(base / cells, cell)
    },
    /** Each switch waiting on a warm-up told to `mark`, to be asked again. */
    again(mark: (at: number) => void) {
      for (const at of waiting) mark(at)
      waiting.clear()
    },
    /** A switch that draws an actor waits until `next` says its warm-up passed; none, it waits for
     *  nothing past its loads. */
    warmWith(next?: ActorWarmth) {
      warmth = next
    },
    /** Whether a switch waits on an actor's warm-up. */
    get warming() {
      return waiting.size > 0
    },
    /** The initial load ends: a switch waits on a warm-up from now on. */
    firstImageShown() {
      initial = false
    },
    /** A load blocks on slow streaming (`on`), or blocks no more; whether that moved. */
    blockingLoad(on: boolean) {
      const moved = blocking !== on
      blocking = on
      return moved
    },
    /** The HLOD actors are on, or off; whether that moved. */
    hlodEnabled(on: boolean) {
      const moved = off === on
      off = !on
      return moved
    },
    /** Whether a load blocks on slow streaming: no HLOD cell turns visible then. */
    get blocking() {
      return blocking
    },
    /** Whether the HLOD actors are on: off, none is drawn. */
    get hlodOn() {
      return !off
    },
  }
}
