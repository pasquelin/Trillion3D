import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import type { CommandWriter, CookedPhysics } from '../../../sdk-core/src/physics/index.ts'
import type { createPhysicsBodies } from './bodies.ts'
import type { SlotOwner } from './bodySlots.ts'
import { createCookedBodies } from './cookedBodies.ts'
import { createCookedSoftBodies } from './cookedSoft.ts'
import type { SharedShapes } from './sharedShapes.ts'
import type { Model } from './tilePlace.ts'

/** The bodies the compiled models in a scene declare, soft (`cookedSoft.ts`) and rigid, opened,
 *  moved, refused and forgotten together, each by its model. */
export function createModelBodies(
  writer: CommandWriter,
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'claim' | 'release'>,
  shapes: SharedShapes,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  const softs = createCookedSoftBodies(writer, bodies, invalidate, failed)
  const rigid = createCookedBodies(writer, bodies, shapes, invalidate, failed)
  const both = [softs, rigid]
  return {
    /** Makes the bodies `model` was `cooked` with, read until `signal` aborts. */
    open(model: Model, cooked: CookedPhysics, signal: AbortSignal) {
      softs.open(model, cooked.softBodies ?? [], signal)
      rigid.open(model, cooked.bodies ?? [], signal)
    },
    forget: (model: Model) => both.forEach((kind) => kind.forget(model)),
    moved: (model: Model) => both.forEach((kind) => kind.moved(model)),
    holds: rigid.holds,
    carry: rigid.carry,
    /** The worker refused the body `owner` holds: one of these leaves; any other is ignored. */
    refused(owner: SlotOwner) {
      if ('soft' in owner) softs.refused(owner)
      else if ('body' in owner) rigid.refused(owner)
    },
  }
}
