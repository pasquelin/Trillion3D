import { cookedSoftSource, type SoftSource } from '../deformation/softSource.ts'
import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import {
  BODY_INDEX,
  ObjectPhysics,
  physicsMatterOf,
  type CommandWriter,
  type CookedSoftBody,
} from '../../../sdk-core/src/physics/index.ts'
import { flagsOf, type createPhysicsBodies } from './bodies.ts'
import { createOpenings } from './modelOpenings.ts'
import { fits, rescaledSoft, writeSoftBody } from './softBodies.ts'
import { holdObjects, letGoAll, type HeldObjects } from './cookedObjects.ts'
import { hasReported } from './cookedReads.ts'
import type { SharedShapes } from './sharedShapes.ts'
import { tilePose, type Model } from './tilePlace.ts'

/** The settings object a cooked soft body is made from. */
const settingsObject = (soft: CookedSoftBody) => soft.settings

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
export function createCookedSoftBodies(
  writer: CommandWriter,
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'claim' | 'release'>,
  shapes: SharedShapes,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  /** Each open model's opening: its soft bodies made, those refused at another scale, the
   *  settings they are made from, held (`cookedObjects.ts`), and the signal its model's leaving
   *  aborts its reads by. */
  type Opening = {
    made: CookedMade[]
    refused: CookedSoftBody[]
    settings: HeldObjects
    signal: AbortSignal
  }
  const held = createOpenings<Opening>(bodies.release, (opening) =>
    letGoAll(shapes, opening.settings),
  )
  /** Each soft body's settings, read once (`SharedShapes.read`) and kept by its cooked entry,
   *  freed with it: a body made again, back at its scale, never waits on the network. */
  const kept = new WeakMap<CookedSoftBody, Promise<Uint8Array>>()
  function settingsOf(opening: Opening, soft: CookedSoftBody) {
    let bytes = kept.get(soft)
    if (!bytes) kept.set(soft, (bytes = shapes.read(opening.settings.get(soft.settings.url)!)))
    return bytes
  }
  /** Lists `soft` refused in `opening`, and refuses it by name: at another scale than it was
   *  cooked at. */
  function refuse(opening: Opening, soft: CookedSoftBody) {
    opening.refused.push(soft)
    failed(rescaledSoft(`of node ${soft.node}`, soft.scale, { node: soft.node }))
  }
  async function add(model: Model, opening: Opening, soft: CookedSoftBody) {
    const cooked = await settingsOf(opening, soft)
    if (!held.current(model, opening)) return
    const { position, quaternion, scale } = tilePose({ model, instance: soft })
    if (!fits(scale, soft.scale)) return refuse(opening, soft)
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
      (error) => opening.signal.aborted || hasReported(error) || failed(error as EngineError),
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
     *  their flags written again; one rescaled is released and refused by name — the physics module scales no
     *  soft body once made —, and made again once back at its scale. */
    moved(model: Model) {
      const opening = held.get(model)
      if (!opening) return
      // Back at its scale, a refused body is made again. Both lists are compacted in place: a
      // model moved every frame makes no new list.
      const { refused, made } = opening
      let waiting = 0
      for (const soft of refused)
        if (fits(tilePose({ model, instance: soft }).scale, soft.scale)) start(model, opening, soft)
        else refused[waiting++] = soft
      refused.length = waiting
      let kept = 0
      for (const body of made) {
        const { position, quaternion, scale } = tilePose({ model, instance: body.soft })
        const slot = body.id & BODY_INDEX
        if (!fits(scale, body.soft.scale)) {
          bodies.release(slot)
          refuse(opening, body.soft)
          continue
        }
        writer.teleport(slot, position, quaternion)
        writer.flags(slot, flagsOf({ physics: body.physics, visible: model.visible }))
        made[kept++] = body
      }
      made.length = kept
    },
    /** The worker refused `soft`, a body of `model`'s (`SlotOwner`): out of its opening, its
     *  slot and soft vertices given back; neither carried nor made again until its model opens
     *  again. */
    refused: ({ model, soft }: { model: Model; soft: CookedMade }) => void held.drop(model, soft),
  }
}
