import { BODY_INDEX } from '../../../sdk-core/src/physics/layout.ts'
import type { Model } from './tiles/tilePlace.ts'

/**
 * The starts of the bodies an opening declares, one per body started — made, on its way, or
 * refused a scale and waiting for another —, each named by a token: a read that lands after its
 * start was ended, or made again, finds the token gone and makes nothing. A body refused for good
 * is out, never started again while its opening stands.
 */
export class Starts<E> {
  private readonly live = new Map<E, object>()
  private readonly out = new Set<E>()
  /** Whether `entry` is started. */
  has(entry: E) {
    return this.live.has(entry)
  }
  /** Whether `entry` is out for good. */
  isOut(entry: E) {
    return this.out.has(entry)
  }
  /** `entry` started: the token that names this start. */
  begin(entry: E) {
    const token = {}
    this.live.set(entry, token)
    return token
  }
  /** Whether `token` still names `entry`'s start. */
  stands(entry: E, token: object) {
    return this.live.get(entry) === token
  }
  /** `entry`'s start ended: whether it was started. */
  end(entry: E) {
    return this.live.delete(entry)
  }
  /** `entry` out for good, whichever start it has ended. */
  forsake(entry: E) {
    this.live.delete(entry)
    this.out.add(entry)
  }
  /** `entry` out for good, its start `token` ended: whether that start stood. */
  forsakeIf(entry: E, token: object) {
    if (this.live.get(entry) !== token) return false
    this.forsake(entry)
    return true
  }
}

type OpeningShape<E> = {
  made: { id: number }[]
  refused: object[]
  declared: readonly E[]
  starts: Starts<E>
}

/** The openings by model, and how one is given up or loses a made body, its slot given back. */
function createHeldOpenings<O extends Pick<OpeningShape<unknown>, 'made'>>(
  release: (index: number) => void,
  left: (opening: O) => void,
) {
  const held = new Map<Model, O>()
  const forget = (model: Model) => {
    const opening = held.get(model)
    if (!opening) return
    opening.made.forEach(({ id }) => release(id & BODY_INDEX))
    held.delete(model)
    left(opening)
  }
  /** `made` out of `model`'s opening, its slot given back: the opening, or `undefined` when
   *  `made` was not in it — its slot then already given back, perhaps taken again. */
  const drop = (model: Model, made: O['made'][number]) => {
    const opening = held.get(model)
    const at = opening?.made.indexOf(made) ?? -1
    if (at < 0) return undefined
    opening!.made.splice(at, 1)
    release(made.id & BODY_INDEX)
    return opening
  }
  return { held, forget, drop }
}

/**
 * Each open model's opening of the bodies it declares, one per model, `made` holding the bodies
 * made from it (`cooked/cookedBodies.ts`, `soft/cookedSoft.ts`): a model opened again, or forgotten, gives
 * its last opening's slots back, then hands that opening to `left`, and a read that lands after
 * that is not wanted. A body lives with the cell that draws its node: `stream` brings an opening's
 * bodies in line with the cells placed, each time they move.
 */
export function createOpenings<E extends { node: number }, O extends OpeningShape<E>>(
  release: (index: number) => void,
  left: (opening: O) => void,
  /** The declared entry a made body or a refused one stands for. */
  entryOf: (one: O['made'][number] | O['refused'][number]) => E,
) {
  const { held, forget, drop } = createHeldOpenings(release, left)
  /** What each opening's cells drew when it last looked (`ModelCells.changes`). */
  const seen = new WeakMap<O, number>()
  /** `entry` stopped: made, its slot given back; refused a scale, no more waited for; on its way,
   *  its start forgotten (ended by the caller). */
  const stop = (model: Model, opening: O, entry: E, unrefused?: (opening: O, entry: E) => void) => {
    const made = opening.made.find((one) => entryOf(one) === entry)
    if (made) drop(model, made)
    const refused = opening.refused.findIndex((one) => entryOf(one) === entry)
    if (refused < 0) return
    opening.refused.splice(refused, 1)
    unrefused?.(opening, entry)
  }
  return {
    get: (model: Model) => held.get(model),
    values: () => held.values(),
    /** `opening` becomes `model`'s, its last one's bodies out: none held twice. */
    open(model: Model, opening: O) {
      forget(model)
      held.set(model, opening)
    },
    /** A model left the scene, or physics turned off: its bodies out. */
    forget,
    /** Whether `opening` is still `model`'s: forgotten or opened again meanwhile, it is not. */
    current: (model: Model, opening: O) => held.get(model) === opening,
    /** Brings `model`'s opening in line with what its cells draw, the first time it is asked and
     *  each time they drew something else since: the bodies of its nodes the cells hold (`ModelCells.holds`)
     *  are started, those they no longer hold stopped — all of them started for a model no cell
     *  draws. */
    stream(
      model: Model,
      start: (model: Model, opening: O, entry: E) => void,
      /** `entry` stopped while refused a scale: it was waited for. */
      unrefused?: (opening: O, entry: E) => void,
    ) {
      const opening = held.get(model)
      if (!opening) return
      const cells = model._cells?.() ?? null
      const changes = cells?.changes ?? 0
      if (seen.get(opening) === changes) return
      seen.set(opening, changes)
      for (const entry of opening.declared) {
        const wanted = !cells || cells.holds(entry.node)
        if (opening.starts.isOut(entry) || wanted === opening.starts.has(entry)) continue
        if (wanted) start(model, opening, entry)
        else if (opening.starts.end(entry)) stop(model, opening, entry, unrefused)
      }
    },
    drop,
  }
}
