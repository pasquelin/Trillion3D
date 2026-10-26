import type { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import { BODY_INDEX, FLAG, MOTION } from '../../../../sdk-core/src/physics/layout.ts'
import { bodyCollision } from '../../../../sdk-core/src/physics/collisionChannels.ts'
import { declaredMass, declaredShape } from '../../../../sdk-core/src/physics/declared.ts'
import { physicsMatterOf } from '../../../../sdk-core/src/physics/matter.ts'
import type { CookedBody } from '../../../../sdk-core/src/physics/cooked.ts'
import { TRIANGLE_BYTES } from '../../../../sdk-core/src/physics/options.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { resolveCameraWorld } from '../../camera/world.ts'
import { worldPoseOf } from '../bodies/bodyFrame.ts'
import { bodyNodes, countNodes, type BodyNodes } from '../bodies/bodyNodes.ts'
import { carriedFrom, driveCarried, type Carried } from '../bodies/carriedBodies.ts'
import { createOpenings, Starts } from '../modelOpenings.ts'
import { fits, followModel } from './cookedMoved.ts'
import {
  cookedHull,
  holdObjects,
  hullOf,
  letGoAll,
  type HeldObjects,
  type CookedParts,
} from './cookedObjects.ts'
import { tilePose, type Model } from '../tiles/tilePlace.ts'

/** The scene node a dynamic body's poses move, how far around it it wants ground, and the world
 *  scale its body was made at: what the poses and the tiles read (`../bodies/bodySlots.ts`). */
export type NodeMove = { node: Object3D; reach: number; scale: readonly number[] }
/** A declared body made: its entry, the world scale it was made at, its id, and — a dynamic one
 *  — the node it moves, or — a kinematic one a dynamic body carries — the node it follows
 *  (`../bodies/carriedBodies.ts`). */
export type CookedMadeBody = {
  body: CookedBody
  scale: number[]
  id: number
  moves: NodeMove | null
  carried?: Carried
}
/** A declared body a rescale refused: its entry, the world scale it was at. */
type Refused = Pick<CookedMadeBody, 'body' | 'scale'>

/** Each open model's opening: the nodes its bodies stand for (`../bodies/bodyNodes.ts`), the
 *  bodies it declares and their starts, its bodies made, those a rescale refused with the scale
 *  it was at, the hulls they are built on — held, and restored while held (`cookedObjects.ts`) —,
 *  and the signal its leaving aborts its reads by. */
type Opening = BodyNodes & {
  declared: readonly CookedBody[]
  starts: Starts<CookedBody>
  made: CookedMadeBody[]
  refused: Refused[]
  hulls: HeldObjects
  signal: AbortSignal
}
type HeldOpenings = ReturnType<typeof createOpenings<CookedBody, Opening>>

/** `body` made where its model places it now — a dynamic or carried one where its node is
 *  drawn —, on its restored hull; throws, nothing held, for a shape the scale bends or a body
 *  past the budget. */
function makeCooked(parts: CookedParts, model: Model, opening: Opening, body: CookedBody) {
  const { writer, bodies, invalidate } = parts
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
  const filter = writer.filter(bodyCollision({ type: moving ? 'dynamic' : 'kinematic' }), false)
  if (follows) made.carried = carriedFrom(follows, position, quaternion)
  writer.add({
    ...{ id: made.id, motion: moving ? MOTION.dynamic : MOTION.kinematic },
    ...{ filter, shape: resolved.shape, position, quaternion },
    // Held or kinematic, it is added asleep: it stands still until its model moves it.
    flags: moving ? 0 : FLAG.asleep,
    ...{ size: resolved.size, ...declaredMass(body, scale), density: matter.density },
    ...{ friction: matter.friction, restitution: matter.restitution },
    ...{ gravityScale: body.motion.gravityFactor ?? 1, indices: hull && [hull.handle] },
  })
  invalidate()
  return made
}

/** How a body starts, is refused and is made again at another scale, for the openings `held`. */
function createCookedLifecycle(parts: CookedParts, held: HeldOpenings) {
  const { shapes, failed } = parts
  async function add(model: Model, opening: Opening, body: CookedBody, token: object) {
    const hull = hullOf(opening.hulls, body)
    // Read and restored by the first body that needs it, of this opening or another; refused
    // there, reported by the registry, the body is refused too.
    if (hull && !(await shapes.restored(hull))) return forsake(opening, body, token)
    // Its model, or its cells, let go of it meanwhile: none is made.
    if (held.current(model, opening) && opening.starts.stands(body, token))
      opening.made.push(makeCooked(parts, model, opening, body))
  }
  /** `body` refused — but for a read its model let go of —: its nodes static ground again, and
   *  its `error` reported, if any. */
  const refuse = (opening: Opening, body: CookedBody, error?: unknown) => {
    if (opening.signal.aborted) return
    countNodes(opening, body, -1)
    if (error !== undefined) failed(error as EngineError)
  }
  /** `body`, of the start `token`, refused for good — its hull, its shape or the budget —: out
   *  until its model opens again, unless its cells let go of that start meanwhile. */
  function forsake(opening: Opening, body: CookedBody, token: object, error?: unknown) {
    if (opening.starts.forsakeIf(body, token)) refuse(opening, body, error)
  }
  const start = (model: Model, opening: Opening, body: CookedBody) => {
    const token = opening.starts.begin(body)
    void add(model, opening, body, token).catch((error) => forsake(opening, body, token, error))
  }
  /** `body` let go of with its cells while refused a scale: its nodes expected again as before. */
  const unrefused = (opening: Opening, body: CookedBody) => countNodes(opening, body, 1)
  const stream = (model: Model) => held.stream(model, start, unrefused)
  /** `body` made again at `model`'s `scale` now, kept in `opening`; refused there, it waits in
   *  its `refused` list for another scale. One refused before stands for its nodes again. */
  function remake(
    model: Model,
    opening: Opening,
    { body }: Refused,
    scale: number[],
    refused: boolean,
  ) {
    if (refused) countNodes(opening, body, 1)
    try {
      return makeCooked(parts, model, opening, body)
    } catch (error) {
      opening.refused.push({ body, scale })
      refuse(opening, body, error)
      return null
    }
  }
  return { stream, remake }
}

/** A model moved: its bodies follow it (`followModel`) — a carried one driven where its
 *  node is, any other kinematic one where its model puts it. */
function followCooked(
  parts: CookedParts,
  opening: Opening,
  model: Model,
  remake: ReturnType<typeof createCookedLifecycle>['remake'],
) {
  const { writer, bodies } = parts
  followModel<CookedMadeBody, Refused>(model, {
    ...{ made: opening.made, refused: opening.refused },
    entry: (one) => one.body,
    madeAt: (one) => one.scale,
    // It carries nothing: it leaves before it is made again, so a rescale needs no slot past
    // the budget; refused at a scale, tried again at any other.
    remake(one, scale) {
      bodies.release(one.id & BODY_INDEX)
      return remake(model, opening, one, scale, false)
    },
    tries: (one, scale) => !fits(scale, one.scale),
    retry: (one, scale) => remake(model, opening, one, scale, true),
    place(one, { position, quaternion }) {
      const slot = one.id & BODY_INDEX
      if (one.carried) driveCarried(writer, one.carried, slot)
      else if (!one.moves) writer.moveKinematic(slot, position, quaternion)
    },
  })
}

/**
 * The rigid bodies the compiled models in a scene declare (`physics.json` `bodies`), each one a
 * body of its model's (`../bodies/bodySlots.ts`): its declared shape in the module's terms, or its cooked hull
 * fetched and restored — nothing built on the page —, with its declared mass over its cooked one
 * (`declaredMass`), counted against `budget.physics`. A body is made when the cells that draw its
 * node are placed and let go of when they leave (`stream`); one whose node the core draws, or that
 * draws nothing, is made as its model opens. A kinematic body follows its model, or,
 * inside a dynamic body's subtree, its node as that body carries it (`../bodies/carriedBodies.ts`). A
 * dynamic one simulates, and its poses move its node (`../poses.ts`), which loads tiles as a mover
 * (`moversOf`); held kinematic where its node is drawn when its model numbers its nodes otherwise
 * than the source (`Model._nodeAt`). A body made, the static instances of its node and of the
 * node its collider names (`colliderNode`) leave (`holds`) — a dynamic one's whole subtree's,
 * which moves with it —: no collider is doubled.
 */
export function createCookedBodies(parts: CookedParts) {
  const { writer, bodies, shapes } = parts
  const held = createOpenings<CookedBody, Opening>(
    bodies.release,
    (opening) => letGoAll(shapes, opening.hulls),
    (one) => one.body,
  )
  const { stream, remake } = createCookedLifecycle(parts, held)
  return {
    /** Makes the bodies `model` declares, read until `signal` aborts, the last opening's out. */
    open(model: Model, declared: readonly CookedBody[], signal: AbortSignal) {
      const nodes = bodyNodes(model, declared)
      const hulls = holdObjects(shapes, model, 'hull', declared.map(cookedHull))
      const opening: Opening = {
        ...nodes,
        declared,
        hulls,
        signal,
        starts: new Starts<CookedBody>(),
        made: [],
        refused: [],
      }
      held.open(model, opening)
      stream(model)
    },
    /** The cells of `model` drew something else since the last look: the bodies of its nodes
     *  they hold are made, the others let go of. */
    stream,
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
    moved(model: Model) {
      const opening = held.get(model)
      if (opening) followCooked(parts, opening, model, remake)
    },
    /** The worker refused `body`'s shape: out, its node static ground again, until its model
     *  opens again. */
    refused({ model, body }: { model: Model; body: CookedMadeBody }) {
      const opening = held.drop(model, body)
      if (!opening) return
      opening.starts.forsake(body.body)
      countNodes(opening, body.body, -1)
    },
  }
}
