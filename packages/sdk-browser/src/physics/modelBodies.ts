import type { CookedParts } from './cookedObjects.ts'
import type { CookedPhysics } from '../../../sdk-core/src/physics/index.ts'
import type { SlotOwner } from './bodySlots.ts'
import { createCookedBodies } from './cookedBodies.ts'
import { createCookedSoftBodies } from './cookedSoft.ts'
import type { Model } from './tilePlace.ts'

/** The bodies the compiled models in a scene declare, soft (`cookedSoft.ts`) and rigid, opened,
 *  moved, refused and forgotten together, each by its model. */
export function createModelBodies(parts: CookedParts) {
  const softs = createCookedSoftBodies(parts)
  const rigid = createCookedBodies(parts)
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
