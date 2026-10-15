import type { CookedInstance } from '../../../sdk-core/src/physics/cooked.ts'
import { fits } from './softBodies.ts'
import { tilePose, type Model } from './tilePlace.ts'

/**
 * A model's bodies of one kind as a move reads them: those made (`M`) and those a rescale refused
 * (`R`), each with its entry (placed in its model by `tilePose`) and the world scale it was made,
 * or refused, at; how one is made again at a scale (`again`: the body, or null — refused there and
 * listed among the refused by `again` itself, or on its way), let go of, and placed.
 */
export type Following<M, R> = {
  made: M[]
  refused: R[]
  entry(one: M | R): Omit<CookedInstance, 'collider'>
  madeAt(one: M | R): ArrayLike<number>
  again(one: M | R, scale: number[], refused: boolean): M | null
  release(one: M): void
  place(one: M, pose: ReturnType<typeof tilePose>): void
}

/**
 * `model` moved: its bodies of one kind follow — THE ONE RESCALE RULE of a compiled model's
 * bodies, rigid and soft. One placed off the scale it was made at is let go of and made again at
 * once at its new one (the module scaling no body once made); one that cannot be made there (a
 * shape the scale bends, a cooked soft body away from its cooked scale) is refused by name and
 * waits, made again once its model is at another scale. The others are placed where it now puts
 * them. The lists are compacted in place: a model moved every frame makes no new one. A body
 * moving its node is not placed here: its node is followed with every node under the move
 * (`followMove`).
 */
export function followModel<M, R>(model: Model, f: Following<M, R>) {
  const { made, refused } = f
  const waited = refused.length
  let waiting = 0
  for (let i = 0; i < waited; i++) {
    const one = refused[i]
    const { scale } = tilePose({ model, instance: f.entry(one) })
    if (fits(scale, f.madeAt(one))) refused[waiting++] = one
    else {
      const again = f.again(one, [scale.x, scale.y, scale.z], true)
      if (again) made.push(again)
    }
  }
  // Those refused again, listed past the first, follow the ones still waiting.
  refused.copyWithin(waiting, waited)
  refused.length -= waited - waiting
  let kept = 0
  for (const one of made) {
    const pose = tilePose({ model, instance: f.entry(one) })
    if (!fits(pose.scale, f.madeAt(one))) {
      f.release(one)
      const again = f.again(one, [pose.scale.x, pose.scale.y, pose.scale.z], false)
      if (again) made[kept++] = again
      continue
    }
    f.place(one, pose)
    made[kept++] = one
  }
  made.length = kept
}
