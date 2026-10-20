import { cookedSoftSource, type SoftSource } from '../../deformation/softSource.ts'
import type { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import { BODY_INDEX } from '../../../../sdk-core/src/physics/layout.ts'
import { ObjectPhysics } from '../../../../sdk-core/src/physics/objectPhysics.ts'
import { physicsMatterOf } from '../../../../sdk-core/src/physics/matter.ts'
import type { CookedSoftBody } from '../../../../sdk-core/src/physics/cooked.ts'
import { flagsOf } from '../bodies/bodies.ts'
import { createOpenings } from '../modelOpenings.ts'
import { fits, rescaledSoft, writeSoftBody } from './softBodies.ts'
import {
  holdObjects,
  letGoAll,
  type HeldObjects,
  type CookedParts,
} from '../cooked/cookedObjects.ts'
import { followModel } from '../cooked/cookedMoved.ts'
import { tilePose, type Model } from '../tiles/tilePlace.ts'

/** The settings object a cooked soft body is made from. */
const settingsObject = (soft: CookedSoftBody) => soft.settings

/** A cooked soft body a rescale refused: its entry, the world scale it was at. */
type Refused = { soft: CookedSoftBody; scale: number[] }

/** A cooked soft body made: its entry, its options, its engine id. */
export type CookedMade = {
  soft: CookedSoftBody
  physics: ObjectPhysics
  id: number
  source?: SoftSource
}

/**
 * The cooked soft bodies of the compiled models in a scene (`physics.json` `softBodies`): each
 * one's settings fetched and handed to the simulation as the physics module restores them — a decode and a
 * copy, nothing built on the page — at its node's place in its model, within
 * `budget.physics.softVertices`. Its matter, pull and damping are the options its node declares,
 * read as `obj.physics` reads them, and its flags those a page-built one takes (`flagsOf`), its
 * model's visibility for its own. The physics module scales no soft body once made: a model placed at another
 * scale than the one it was cooked at has its soft bodies refused, by name.
 */
export function createCookedSoftBodies(parts: CookedParts) {
  const { writer, bodies, shapes, invalidate, failed } = parts
  /** Each open model's opening: its soft bodies made, those refused at another scale, the
   *  settings they are made from — held (`../cooked/cookedObjects.ts`), read once by URL for every body and
   *  model naming them and kept while held: a body made again never waits on the network —, and
   *  the signal its model's leaving aborts its reads by. */
  type Opening = {
    made: CookedMade[]
    refused: Refused[]
    settings: HeldObjects
    signal: AbortSignal
  }
  const held = createOpenings<Opening>(bodies.release, (opening) =>
    letGoAll(shapes, opening.settings),
  )
  /** Lists `soft` refused in `opening` at world `scale`, and refuses it by name: at another
   *  scale than it was cooked at. */
  function refuse(
    opening: Opening,
    soft: CookedSoftBody,
    scale: { x: number; y: number; z: number },
  ) {
    opening.refused.push({ soft, scale: [scale.x, scale.y, scale.z] })
    failed(rescaledSoft(`of node ${soft.node}`, soft.scale, { node: soft.node }))
  }
  async function add(model: Model, opening: Opening, soft: CookedSoftBody) {
    // Its settings' read failed: reported by the registry, the body not made.
    const cooked = await shapes.read(opening.settings.get(soft.settings.url)!).catch(() => null)
    if (!cooked || !held.current(model, opening)) return
    const { position, quaternion, scale } = tilePose({ model, instance: soft })
    if (!fits(scale, soft.scale)) return refuse(opening, soft, scale)
    const p = new ObjectPhysics(soft.physics)
    const made: CookedMade = { soft, physics: p, id: -1, source: cookedSoftSource(model, soft) }
    made.id = bodies.claim(0, soft.vertices, { model, soft: made })
    // Held at once: a throw below still leaves the slot for `forget` to release.
    opening.made.push(made)
    // The collider's matter picked: `physics`, the options, is no preset name here.
    const matter = physicsMatterOf({ friction: soft.friction, restitution: soft.restitution })
    const record = { cooked, pressure: soft.pressure }
    const pose = { position, quaternion, scale: soft.scale }
    const flags = flagsOf({ physics: p, visible: model.visible })
    writeSoftBody(writer, made.id, p, matter, pose, record, flags)
    invalidate()
  }
  /** Restores `soft` in `opening`, a failure reported but for a read its model let go of. */
  const start = (model: Model, opening: Opening, soft: CookedSoftBody) =>
    void add(model, opening, soft).catch(
      (error) => opening.signal.aborted || failed(error as EngineError),
    )
  return {
    /** Makes the soft bodies `model` was cooked with, read until `signal` aborts, the last
     *  opening's out. */
    open(model: Model, softBodies: readonly CookedSoftBody[], signal: AbortSignal) {
      const settings = holdObjects(shapes, model, 'settings', softBodies.map(settingsObject))
      const opening: Opening = { made: [], refused: [], settings, signal }
      held.open(model, opening)
      for (const soft of softBodies) start(model, opening, soft)
    },
    forget: held.forget,
    /** A model moved or hidden: its soft bodies carried where it now is, their simulation kept,
     *  their flags written again (`followModel`); one rescaled is refused by name until its model
     *  is back at its cooked scale. */
    moved(model: Model) {
      const opening = held.get(model)
      if (!opening) return
      followModel<CookedMade, Refused>(model, {
        ...{ made: opening.made, refused: opening.refused },
        entry: (one) => one.soft,
        madeAt: (one) => one.soft.scale,
        // Its cooked settings cannot be made at another scale: let go of and refused by name,
        // made again only once its model is back at its cooked scale.
        remake(one, [x, y, z]) {
          bodies.release(one.id & BODY_INDEX)
          refuse(opening, one.soft, { x, y, z })
          return null
        },
        tries: (one, scale) => fits(scale, one.soft.scale),
        retry(one) {
          start(model, opening, one.soft)
          return null
        },
        place(one, { position, quaternion }) {
          const slot = one.id & BODY_INDEX
          writer.teleport(slot, position, quaternion)
          writer.flags(slot, flagsOf({ physics: one.physics, visible: model.visible }))
        },
      })
    },
    /** The worker refused `soft`, a body of `model`'s (`SlotOwner`): out of its opening, its
     *  slot and soft vertices given back; neither carried nor made again until its model opens
     *  again. */
    refused: ({ model, soft }: { model: Model; soft: CookedMade }) => void held.drop(model, soft),
  }
}
