import type { EngineError } from '../../../sdk-core/src/contracts/cache.ts'
import {
  BODY_INDEX,
  FLAG,
  LAYER,
  MOTION,
  declaredMass,
  declaredShape,
  physicsMatterOf,
  type CommandWriter,
  type CookedBody,
  TRIANGLE_BYTES,
} from '../../../sdk-core/src/physics/index.ts'
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { resolveCameraWorld } from '../camera/world.ts'
import type { createPhysicsBodies } from './bodies.ts'
import { worldPoseOf } from './bodyFrame.ts'
import { bodyNodes, countNodes, type BodyNodes } from './bodyNodes.ts'
import { carriedFrom, driveCarried, type Carried } from './carriedBodies.ts'
import { createOpenings } from './modelOpenings.ts'
import { followModel } from './cookedMoved.ts'
import { cookedHull, holdObjects, hullOf, letGoAll, type HeldObjects } from './cookedObjects.ts'
import { hasReported } from './cookedReads.ts'
import type { SharedShapes } from './sharedShapes.ts'
import { tilePose, type Model } from './tilePlace.ts'

/** The scene node a dynamic body's poses move, how far around it it wants ground, and the world
 *  scale its body was made at: what the poses and the tiles read (`bodySlots.ts`). */
export type NodeMove = { node: Object3D; reach: number; scale: readonly number[] }
/** A declared body made: its entry, the world scale it was made at, its id, and — a dynamic one
 *  — the node it moves, or — a kinematic one a dynamic body carries — the node it follows
 *  (`carriedBodies.ts`). */
export type CookedMadeBody = {
  body: CookedBody
  scale: number[]
  id: number
  moves: NodeMove | null
  carried?: Carried
}
/** A declared body a rescale refused: its entry, the world scale it was at. */
export type Refused = Pick<CookedMadeBody, 'body' | 'scale'>

/**
 * The rigid bodies the compiled models in a scene declare (`physics.json` `bodies`), each one a
 * body of its model's (`bodySlots.ts`): its declared shape in the module's terms, or its cooked hull
 * fetched and restored — nothing built on the page —, with its declared mass over its cooked one
 * (`declaredMass`), counted against `budget.physics`. A kinematic body follows its model, or,
 * inside a dynamic body's subtree, its node as that body carries it (`carriedBodies.ts`). A
 * dynamic one simulates, and its poses move its node (`poses.ts`), which loads tiles as a mover
 * (`moversOf`); held kinematic where its node is drawn when its model numbers its nodes otherwise
 * than the source (`Model._nodeAt`). A body made, the static instances of its node and of the
 * node its collider names (`colliderNode`) leave (`holds`) — a dynamic one's whole subtree's,
 * which moves with it —: no collider is doubled.
 */
export function createCookedBodies(
  writer: CommandWriter,
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'claim' | 'release'>,
  shapes: SharedShapes,
  invalidate: () => void,
  failed: (error: EngineError) => void,
) {
  /** Each open model's opening: the nodes its bodies stand for (`bodyNodes.ts`), its bodies
   *  made, those a rescale refused with the scale it was at, the hulls they are built on — held,
   *  and restored while held (`cookedObjects.ts`) —, and the signal its leaving aborts its reads
   *  by. */
  type Opening = BodyNodes & {
    made: CookedMadeBody[]
    refused: Refused[]
    hulls: HeldObjects
    signal: AbortSignal
  }
  const held = createOpenings<Opening>(bodies.release, (opening) => letGoAll(shapes, opening.hulls))
  /** `body` made where its model places it now — a dynamic or carried one where its node is
   *  drawn —, on its restored hull; throws, nothing held, for a shape the scale bends or a body
   *  past the budget. */
  function make(model: Model, opening: Opening, body: CookedBody) {
    const placed = tilePose({ model, instance: body })
    const { scale } = placed
    const resolved = declaredShape(body, scale)
    const at = opening.moving.get(body)
    const follows = opening.carried.get(body)
    const size = [scale.x, scale.y, scale.z]
    // Its radius is in its parent's frame: scaled by that parent's world scale.
    const parent = at && resolveCameraWorld(at.node.parent ?? model).matrixWorld
    const moves = at
      ? { node: at.node, reach: at.radius * parent!.getMaxScaleOnAxis(), scale: size }
      : null
    const drawn = at?.node ?? follows
    const { position, quaternion } = drawn ? worldPoseOf(drawn) : placed
    const hull = hullOf(opening.hulls, body)
    const made: CookedMadeBody = { body, scale: size, id: -1, moves }
    made.id = bodies.claim(resolved.triangles * TRIANGLE_BYTES, 0, { model, body: made })
    const matter = physicsMatterOf(body)
    const moving = !!moves
    if (follows) made.carried = carriedFrom(follows, position, quaternion)
    writer.add({
      ...{ id: made.id, motion: moving ? MOTION.dynamic : MOTION.kinematic },
      ...{ layer: LAYER.moving, shape: resolved.shape, position, quaternion },
      // Held or kinematic, it is added asleep: it stands still until its model moves it.
      flags: moving ? 0 : FLAG.asleep,
      ...{ size: resolved.size, ...declaredMass(body, scale), density: matter.density },
      ...{ friction: matter.friction, restitution: matter.restitution },
      ...{ gravityScale: body.motion.gravityFactor ?? 1, indices: hull && [hull.handle] },
    })
    invalidate()
    return made
  }
  async function add(model: Model, opening: Opening, body: CookedBody) {
    const hull = hullOf(opening.hulls, body)
    // Read and restored by the first body that needs it, of this opening or another.
    if (hull) await shapes.restored(hull)
    if (held.current(model, opening)) opening.made.push(make(model, opening, body))
  }
  /** `body` refused — but for a read its model let go of —: reported, but for a failed read the
   *  registry reported, its nodes static ground again. */
  const refuse = (opening: Opening, body: CookedBody, error: unknown) => {
    if (opening.signal.aborted) return
    countNodes(opening, body, -1)
    if (!hasReported(error)) failed(error as EngineError)
  }
  const start = (model: Model, opening: Opening, body: CookedBody) =>
    void add(model, opening, body).catch((error) => refuse(opening, body, error))
  /** `body` made again at `model`'s `scale` now, kept in `opening`; refused there, it waits in
   *  its `refused` list for another scale. */
  function remake(model: Model, opening: Opening, { body }: Refused, scale: number[]) {
    // Its hull not restored yet — waiting for room, or its read failed —: read and restored first.
    if (hullOf(opening.hulls, body)?.handle === -1) return start(model, opening, body)
    try {
      return make(model, opening, body)
    } catch (error) {
      opening.refused.push({ body, scale })
      refuse(opening, body, error)
      return null
    }
  }
  return {
    /** Makes the bodies `model` declares, read until `signal` aborts, the last opening's out. */
    open(model: Model, declared: readonly CookedBody[], signal: AbortSignal) {
      const nodes = bodyNodes(model, declared)
      const hulls = holdObjects(shapes, model, 'hull', declared.map(cookedHull))
      const opening: Opening = { ...nodes, made: [], refused: [], hulls, signal }
      held.open(model, opening)
      for (const body of declared) start(model, opening, body)
    },
    forget: held.forget,
    /** Whether node `node` of `model` has its body, made or on its way: its tiles then leave. */
    holds: (model: Model, node: number) => held.get(model)?.nodes.has(node) ?? false,
    /** A frame's poses drawn: each carried body driven where its node now is. */
    carry() {
      for (const { carried, made } of held.values())
        if (carried.size)
          for (const one of made)
            if (one.carried) driveCarried(writer, one.carried, one.id & BODY_INDEX)
    },
    /** A model moved: its bodies follow it (`followModel`). */
    moved(model: Model) {
      const opening = held.get(model)
      if (opening) followModel(writer, model, opening, remake, bodies.release)
    },
    /** The worker refused `body`'s shape: out, its node static ground again, until its model
     *  opens again. */
    refused({ model, body }: { model: Model; body: CookedMadeBody }) {
      const opening = held.drop(model, body)
      if (opening) countNodes(opening, body.body, -1)
    },
  }
}
