import type { CookedInstance } from '../../../../sdk-core/src/physics/cooked.ts'
import { fits } from '../soft/softBodies.ts'
import { tilePose, type Model } from '../tiles/tilePlace.ts'

/** Where a body's node now puts it: its world place, turn and scale. */
export type Pose = {
  position: ArrayLike<number>
  quaternion: ArrayLike<number>
  scale: { x: number; y: number; z: number }
}

/** A made body of one kind as a move reads it: the world scale it was made at, how it is made
 *  again at another (the new body — a page's soft body made before the old one leaves, any other
 *  after —, or null: refused and listed, or on its way), and how it is placed. */
export type Following<M> = {
  madeAt(one: M): ArrayLike<number>
  remake(one: M, scale: number[]): M | null
  place(one: M, pose: Pose): void
}

/**
 * THE ONE RESCALE RULE, every body's — a page's, a compiled model's, rigid or soft —: a body
 * placed off the scale it was made at is made again at its new one, the module scaling no body
 * once made (a page's soft body goes on from the old one, its simulation carried); one that
 * cannot be made there is refused by name and waits (`followModel`). Any other is placed where its
 * node now puts it. Returns the body that stays: it, the one made again, or null.
 */
export function followBody<M>(one: M, pose: Pose, f: Following<M>): M | null {
  if (fits(pose.scale, f.madeAt(one))) return (f.place(one, pose), one)
  return f.remake(one, [pose.scale.x, pose.scale.y, pose.scale.z])
}

/** A compiled model's bodies of one kind: those made (`M`), those a rescale refused (`R`), each
 *  with its entry (placed in its model by `tilePose`); whether one refused can be made at a scale
 *  now, and its making there. */
export type ModelFollowing<M, R> = Following<M> & {
  made: M[]
  refused: R[]
  entry(one: M | R): Omit<CookedInstance, 'collider'>
  tries(one: R, scale: { x: number; y: number; z: number }): boolean
  retry(one: R, scale: number[]): M | null
}

/**
 * `model` moved: its bodies of one kind follow (`followBody`), and those refused that it can now
 * make are made again. The lists are compacted in place: a model moved every frame makes no new
 * one. A body moving its node is not placed here: its node is followed with every node under the
 * move (`followMove`).
 */
export function followModel<M, R>(model: Model, f: ModelFollowing<M, R>) {
  const { made, refused } = f
  const waited = refused.length
  let waiting = 0
  for (let i = 0; i < waited; i++) {
    const one = refused[i]
    const { scale } = tilePose({ model, instance: f.entry(one) })
    if (!f.tries(one, scale)) refused[waiting++] = one
    else {
      const again = f.retry(one, [scale.x, scale.y, scale.z])
      if (again) made.push(again)
    }
  }
  // Those refused again, listed past the first, follow the ones still waiting.
  refused.copyWithin(waiting, waited)
  refused.length -= waited - waiting
  let kept = 0
  for (const one of made) {
    const stays = followBody(one, tilePose({ model, instance: f.entry(one) }), f)
    if (stays) made[kept++] = stays
  }
  made.length = kept
}
