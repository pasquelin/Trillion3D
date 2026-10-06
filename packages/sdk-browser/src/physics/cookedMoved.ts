import { BODY_INDEX, type CommandWriter } from '../../../sdk-core/src/physics/index.ts'
import { worldPoseOf } from './bodyFrame.ts'
import { countNodes, type BodyNodes } from './bodyNodes.ts'
import { driveCarried } from './carriedBodies.ts'
import type { CookedMadeBody, Refused } from './cookedBodies.ts'
import { fits } from './softBodies.ts'
import { tilePose, type Model } from './tilePlace.ts'

/** A model's opening of the bodies it declares, as a move reads it (`cookedBodies.ts`). */
type Moving<O> = O & BodyNodes & { made: CookedMadeBody[]; refused: Refused[] }

/**
 * `model` moved: the bodies of its `opening` follow — a kinematic one driven there, pushing what
 * it meets, a dynamic one put where its node is now drawn —; one rescaled is released and made
 * again at once at its new scale (`remake`), the module scaling no body once made, and one a
 * rescale refused is made again once its model is at another scale. The lists are compacted in
 * place: a model moved every frame makes no new one.
 */
export function followModel<O>(
  writer: CommandWriter,
  model: Model,
  opening: Moving<O>,
  remake: (model: Model, opening: O, one: Refused, scale: number[]) => CookedMadeBody | null | void,
  release: (index: number) => void,
) {
  const { made, refused } = opening
  for (const one of refused.splice(0)) {
    const { scale } = tilePose({ model, instance: one.body })
    if (fits(scale, one.scale)) refused.push(one)
    else {
      countNodes(opening, one.body, 1)
      const again = remake(model, opening, one, [scale.x, scale.y, scale.z])
      if (again) made.push(again)
    }
  }
  let kept = 0
  for (const one of made) {
    const { position, quaternion, scale } = tilePose({ model, instance: one.body })
    const slot = one.id & BODY_INDEX
    if (!fits(scale, one.scale)) {
      release(slot)
      const again = remake(model, opening, one, [scale.x, scale.y, scale.z])
      if (again) made[kept++] = again
      continue
    }
    if (one.moves) {
      const now = worldPoseOf(one.moves.node)
      writer.teleport(slot, now.position, now.quaternion)
    } else if (one.carried) driveCarried(writer, one.carried, slot)
    else writer.moveKinematic(slot, position, quaternion)
    made[kept++] = one
  }
  made.length = kept
}
