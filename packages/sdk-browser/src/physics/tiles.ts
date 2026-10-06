import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import {
  BODY_INDEX,
  collisionShareOf,
  type CommandWriter,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { createPhysicsBodies } from './bodies.ts'
import { createModelBodies } from './modelBodies.ts'
import { SharedShapes } from './sharedShapes.ts'
import { createResidentTiles } from './tileResident.ts'
import { TileSchedule, type TileOpening } from './tileSchedule.ts'
import { cookedPhysics, isModel, locate, placedOf, tilePose, type Model } from './tilePlace.ts'

/**
 * The cooked collision of the compiled models in a scene (`physics.json`), streamed into the
 * simulation within the static collision's share of `budget.memoryBytes` and of `budget.bodies`
 * (`collisionShareOf`), the other bodies keeping the rest: tiles load around every moving body
 * first, then around the eye up to the active range — the camera's draw distance, the scene's
 * own —, nearest first, and leave once no longer wanted. A scene is never
 * refused for its size: a tile that does not fit waits, the farther ones leaving for it. A tile
 * is restored from the module's binary state, never rebuilt; so are the bodies its nodes declare
 * (`cookedBodies.ts`), made as it opens.
 *
 * A tile is one shape for the session (`sharedShapes.ts`), however many placements and models
 * place it. With U tiles of b bytes wanted by P placements (P ≫ U for a prop repeated over a
 * world): U reads fetching U · b bytes, U shapes restored, and U · b bytes of the share held beside
 * P static bodies, each its own pose and scale on its tile's shape, built `BUILDS` an update
 * (`tileSchedule.ts`). A tile placed 1,000 times is read and restored once; a placement whose tile
 * is resident gets its body with no read.
 */
export function createTileStreamer(
  writer: CommandWriter,
  budget: PhysicsBudget,
  bodies: ReturnType<typeof createPhysicsBodies>,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  const models = new Map<Model, TileOpening>()
  // The static collision's shares: of the memory, and of the bodies, the others keeping the rest.
  const share = collisionShareOf(budget, 'memoryBytes'),
    bodyShare = collisionShareOf(budget, 'bodies')
  const shapes = new SharedShapes({ writer, bodies, failed })
  const declared = createModelBodies(writer, bodies, shapes, invalidate, failed)
  const resident = createResidentTiles(writer, bodies, shapes)
  const schedule = new TileSchedule({ bodies, declared, shapes, resident, invalidate, failed })
  function open(model: Model) {
    const opening: TileOpening = { placed: [], abort: new AbortController() }
    const { signal } = opening.abort
    models.set(model, opening)
    cookedPhysics(model, signal)
      .then((cooked) => {
        // A model compiled before the cook collides nowhere.
        if (!cooked || signal.aborted) return
        opening.placed.push(...placedOf(model, cooked, shapes))
        declared.open(model, cooked, signal)
        invalidate()
      })
      // A read its model let go of by leaving is no failure.
      .catch((error) => signal.aborted || failed(error as EngineError))
  }
  /** Everything `model` holds out: its tiles, their shapes let go of, and its declared bodies. */
  const drop = (model: Model, { placed, abort }: TileOpening) => {
    abort.abort()
    placed.forEach(resident.remove)
    declared.forget(model)
  }
  return {
    /** Finds the compiled models under `root`, opening the new ones and forgetting the gone. */
    scan(root: Object3D) {
      const seen = new Set<Model>()
      root.traverse((node) => {
        if (!isModel(node)) return
        seen.add(node)
        if (!models.has(node)) open(node)
      })
      for (const [model, opening] of models)
        if (!seen.has(model)) {
          drop(model, opening)
          models.delete(model)
        }
      schedule.settle()
    },
    /** Carries the bodies a dynamic one holds (`carriedBodies.ts`), then brings the resident
     *  tiles in line with what is wanted (`tileSchedule.ts`) within what the static meshes and
     *  the other bodies leave them. */
    update(eye: ArrayLike<number>, range: number) {
      if (!models.size) return
      declared.carry()
      schedule.want(models, eye, range)
      const count = bodies.count,
        held = resident.held.bodies
      schedule.admit(
        share - count.collisionBytes + shapes.restoredBytes,
        Math.min(bodyShare, budget.bodies - count.bodies + held),
      )
      schedule.start()
    },
    /** The model a tile body's or a cooked body's engine id belongs to, or `null`. */
    modelOf: bodies.slots.modelOf,
    /** The worker refused body `id`, by its own pose or scale: a cooked body, or the placement of a
     *  tile, leaves alone until its model opens again — a tile whose object is refused leaves
     *  whole by its read (`sharedShapes.ts`). */
    refused(id: number) {
      const owner = bodies.slots.of(id)
      if (owner && 'tile' in owner) {
        const placed = models.get(owner.model)!.placed
        resident.remove(owner.tile)
        placed.splice(placed.indexOf(owner.tile), 1)
      } else if (owner) declared.refused(owner)
      schedule.settle()
    },
    /** The glTF material of a tile body's triangles, `-1` for none or for another body. */
    materialOf(id: number) {
      const owner = bodies.slots.of(id)
      return owner && 'tile' in owner ? owner.tile.material : -1
    },
    /** A model moved: its resident tiles and its cooked bodies follow. */
    moved(node: Object3D) {
      node.traverse((child) => {
        if (isModel(child)) declared.moved(child)
        for (const p of (isModel(child) && models.get(child)?.placed) || []) {
          locate(p)
          if (p.id < 0) continue
          const { position, quaternion } = tilePose(p)
          writer.teleport(p.id & BODY_INDEX, position, quaternion)
        }
      })
    },
    /** Every tile and cooked body out (physics turned off). */
    clear() {
      models.forEach((opening, model) => drop(model, opening))
      models.clear()
      schedule.settle()
    },
  }
}
