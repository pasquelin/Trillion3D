/**
 * THE WARM-UPS THE WORLD'S SWITCHES WAIT ON (`worldFollow.ts`).
 *
 * A switch that draws an HLOD actor whose layer asks a warm-up (`CHAIN_ACTOR.warmup`) asks the
 * warm-up it is given (`ActorWarmth`, `../../../frame/prepare/hlodWarm.ts`) whether the actor still
 * needs a frame: while it does, the switch waits, asked again at each cut. The actor drawn or let
 * go, its warm-up ends (`release`). No switch waits on one with no warm-up given, during the
 * initial load — till the first image is shown (`firstImageShown`) —, while a load blocks on slow
 * streaming (`blockingLoad`), as the reference warms nothing for a blocking load, or while the
 * HLOD actors are off (`hlodEnabled`). It also holds what the world draws as a whole: the HLOD
 * actors on or off, the cells activated or only loaded (`activated`).
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

/** `flag` set to `on`; whether that moved it. */
const setFlag = (flag: { on: boolean }, on: boolean) => {
  const moved = flag.on !== on
  flag.on = on
  return moved
}

/** Whether the actor of cell `drawn` of instance `instance`, drawing as cell `cell`, needs no frame
 *  of `warmth`: one whose layer asks none always is. */
function actorWarm(
  actor: Uint8Array,
  warmth: ActorWarmth,
  instance: number,
  drawn: number,
  cell: number,
) {
  return (actor[drawn] & CHAIN_ACTOR.warmup) === 0 || !warmth.warming(instance, drawn, cell)
}

/** The warm-ups the switches of a world of `cells` HLOD cells wait on, its actors' flags `actor`
 *  (`CHAIN_ACTOR`). */
export function createSwitchWarmth(actor: Uint8Array, cells: number) {
  /** The warm-up given, whether the initial load runs, the flags (a load blocks, the HLOD actors
   *  are on, the cells are activated) and the cell slots whose switch waits on a warm-up. */
  let warmth: ActorWarmth | undefined,
    initial = true
  const blocking = { on: false },
    hlod = { on: true },
    active = { on: true },
    waiting = new Set<number>()
  return {
    /** Whether the actor of cell `drawn` at `base`, drawing as cell `cell`, is warmed up — one whose
     *  layer asks none always is —; else slot `asker` waits. */
    ready(base: number, drawn: number, cell: number, asker: number) {
      if (!warmth || initial || blocking.on || !hlod.on) return true
      if (actorWarm(actor, warmth, base / cells, drawn, cell)) return true
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
    blockingLoad: (on: boolean) => setFlag(blocking, on),
    /** The HLOD actors are on, or off; whether that moved. */
    hlodEnabled: (on: boolean) => setFlag(hlod, on),
    /** The cells are activated (`on`), or loaded and not activated; whether that moved. */
    activated: (on: boolean) => setFlag(active, on),
    /** Whether a load blocks on slow streaming: no HLOD cell turns visible then. */
    get blocking() {
      return blocking.on
    },
    /** Whether the HLOD actors are on: off, none is drawn. */
    get hlodOn() {
      return hlod.on
    },
    /** Whether the cells are activated: not, nothing a cell holds is drawn. */
    get drawn() {
      return active.on
    },
  }
}
