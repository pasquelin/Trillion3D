import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import {
  BODY_INDEX,
  collisionBytesOf,
  type CommandWriter,
  type PhysicsBudget,
} from '../../../sdk-core/src/physics/index.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import type { createPhysicsBodies } from './bodies.ts'
import { createModelBodies } from './modelBodies.ts'
import { createTileReads, type TileOpening } from './tileReads.ts'
import { createResidentTiles } from './tileResident.ts'
import { admitTiles, wantedTiles } from './tileRoom.ts'
import { cookedPhysics, isModel, locate, placedOf, tilePose, type Model } from './tilePlace.ts'

/** Tile reads one update starts at most: each is a restore in the worker's next step. */
const LOADS = 2

/**
 * The cooked collision of the compiled models in a scene (`physics.json`), streamed into the
 * simulation within the static collision's share of `budget.memoryBytes` (`collisionBytesOf`) and
 * the bodies `budget.bodies` leaves it: tiles load around every moving body first, then around the
 * eye up to the active range — the camera's draw distance, the scene's own —, nearest first, and
 * leave once no longer wanted. A scene is never refused for its size: a tile that does not fit
 * waits, the farther ones leaving for it. A tile is restored from the module's binary state, never
 * rebuilt; so are the bodies its nodes declare (`cookedBodies.ts`), made as it opens.
 *
 * The placements of one tile in a model share it. With U tiles of b bytes wanted by P placements
 * (P ≫ U for a prop repeated over a world): U reads fetching U · b bytes, U shapes restored, and
 * U · b bytes of the share held beside P static bodies, each its own pose and scale on its tile's
 * shape. A tile placed 1,000 times is read and restored once; a placement whose tile is resident
 * gets its body with no read.
 */
export function createTileStreamer(
  writer: CommandWriter,
  budget: PhysicsBudget,
  bodies: ReturnType<typeof createPhysicsBodies>,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  const models = new Map<Model, TileOpening>()
  const declared = createModelBodies(writer, bodies, invalidate, failed)
  const resident = createResidentTiles(writer, bodies)
  const reads = createTileReads(budget, bodies, resident, invalidate, failed)
  const share = collisionBytesOf(budget)
  let passes = 0
  function open(model: Model) {
    const opening: TileOpening = { placed: [], abort: new AbortController() }
    const { signal } = opening.abort
    models.set(model, opening)
    cookedPhysics(model, signal)
      .then((cooked) => {
        // A model compiled before the cook collides nowhere.
        if (!cooked || signal.aborted) return
        opening.placed.push(...placedOf(model, cooked))
        declared.open(model, cooked, signal)
        invalidate()
      })
      // A read its model let go of by leaving is no failure.
      .catch((error) => signal.aborted || failed(error as EngineError))
  }
  /** Everything `model` holds out: its tiles and the bodies it declares. */
  const drop = (model: Model, { placed, abort }: TileOpening) => {
    abort.abort()
    placed.forEach(resident.evict)
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
      resident.settle()
    },
    /** Carries the bodies a dynamic one holds (`carriedBodies.ts`), then brings the resident
     *  tiles in line with what is wanted (`nearness`): the nearest that fit stay or come in —
     *  on their resident tile at once, else read, `LOADS` reads at most —; past the first that
     *  does not, the farther leave and wait; a tile left without a body is released. */
    update(eye: ArrayLike<number>, range: number) {
      if (!models.size) return
      declared.carry()
      const wanted = wantedTiles(models.values(), bodies, declared, resident.evict, eye, range)
      wanted.sort((a, b) => a[0] - b[0])
      // What the static meshes and the other bodies leave the tiles.
      const { held } = resident,
        { count } = bodies
      const free = {
        bytes: share - count.collisionBytes + held.bytes,
        bodies: budget.bodies - count.bodies + held.bodies,
      }
      admitTiles(wanted, free, ++passes, resident.evict)
      let loads = LOADS
      for (const [, p] of wanted) {
        if (p.out || p.id >= 0) continue
        const { shape } = p
        if (shape.handle >= 0) resident.build(p)
        else if (!shape.reading && reads.free() && loads) {
          loads--
          void reads.read(p.model, models.get(p.model)!, shape)
        }
      }
      resident.settle()
    },
    /** The model a tile body's or a cooked body's engine id belongs to, or `null`. */
    modelOf: bodies.slots.modelOf,
    /** The worker refused body `id`: a tile or a cooked body leaves until its model opens again. */
    refused(id: number) {
      const owner = bodies.slots.of(id)
      if (!owner || !('tile' in owner)) return owner && declared.refused(owner)
      const p = owner.tile,
        { placed } = models.get(owner.model)!
      resident.evict(p)
      resident.settle()
      placed.splice(placed.indexOf(p), 1)
      p.shape.placed.splice(p.shape.placed.indexOf(p), 1)
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
      resident.settle()
    },
  }
}
