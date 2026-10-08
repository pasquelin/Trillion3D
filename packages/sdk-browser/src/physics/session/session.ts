import type { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
import { CommandWriter, type PhysicsBudget } from '../../../../sdk-core/src/physics/index.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { emptyPhysicsStats } from '../protocol.ts'
import { createSessionBodies } from './sessionBodies.ts'
import { createSessionControls } from './sessionControls.ts'
import { createSessionFrame } from './sessionFrame.ts'
import { createSessionState, createWorkerLink } from './sessionLink.ts'
import { listenToWorker } from './sessionMessages.ts'
import type { SessionParts, WantedPhysics } from './sessionParts.ts'
import { startPhysicsWorker } from '../sessionWorker.ts'
import { createPhysicsVehicles } from '../vehicles.ts'
import { createSoftVertices } from '../softVertices.ts'
import { createTileStreamer } from '../tiles.ts'
import { createPhysicsView } from '../view.ts'
import { createCharacterPort, createPhysicsCharacter } from '../physicsCharacter.ts'
import { createStepClock, physicsStep } from '../stepClock.ts'

/**
 * One running simulation: the worker, the bodies, the drawn poses. It exists only once physics is
 * enabled — a world without physics creates none, and fetches no byte of the physics module. Its time is the
 * frames' (`stepClock.ts`): each frame's time is set at its start (`time`), the bodies, the
 * wheels, the soft bodies and the character all drawn at it, between their two states
 * (`twoSteps.ts`) at the one fraction `along` reads; then the frame sends its commands and the
 * steps it owes while the world is awake. A world at rest is sent nothing.
 */
export function createPhysicsSession(
  root: Object3D,
  budget: Readonly<PhysicsBudget>,
  invalidate: () => void,
  failed: (error: EngineError, fatal?: boolean) => void,
  /** The joints and vehicles `world.physics.add` holds: made once their bodies are simulated. */
  wanted: WantedPhysics,
) {
  const writer = new CommandWriter()
  const step = physicsStep()
  const clock = createStepClock(step)
  const stale = new Set<Object3D>()
  const s = createSessionState()
  const { poses, bodies, joints, retire } = createSessionBodies(
    { writer, budget, root, step, stale, s, invalidate },
    wanted,
  )
  const worker = startPhysicsWorker(budget, step)
  const link = createWorkerLink(s, worker, writer, clock, step)
  let onReady = () => {}
  const parts: SessionParts = {
    root,
    budget,
    invalidate,
    failed,
    wanted,
    s,
    link,
    writer,
    clock,
    stale,
    poses,
    bodies,
    joints,
    vehicles: createPhysicsVehicles(writer, bodies, invalidate),
    soft: createSoftVertices(bodies, budget.bodies),
    view: createPhysicsView(),
    stats: emptyPhysicsStats(),
    touched: { id: budget.bodies, eye: null },
    worker,
    tiles: createTileStreamer(writer, budget, bodies, invalidate, (error) => failed(error)),
    casts: new Map(),
    character: createCharacterPort(link.send, link.at),
    retire,
    started: new Promise<void>((resolve) => (onReady = resolve)),
    onReady: () => onReady(),
  }
  listenToWorker(parts)
  return {
    stats: parts.stats,
    writer,
    /** The character's body in this session's worker, for `world.controls`. */
    characterBody: createPhysicsCharacter.bind(null, parts.character),
    ...createSessionControls(parts),
    ...createSessionFrame(parts),
  }
}

/** What `createPhysicsSession` returns. */
export type PhysicsSession = ReturnType<typeof createPhysicsSession>
