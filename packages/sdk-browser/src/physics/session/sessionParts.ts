import type { EngineError } from '../../../../sdk-core/src/contracts/cache.ts';
import type { CommandWriter, PhysicsBudget } from '../../../../sdk-core/src/physics/index.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { createPhysicsBodies } from '../bodies.ts';
import type { createPhysicsJoints } from '../joints.ts';
import type { createJointList } from '../jointList.ts';
import type { createCharacterPort } from '../physicsCharacter.ts';
import type { createPhysicsPoses } from '../poses.ts';
import type { PhysicsStats } from '../protocol.ts';
import type { SessionState, WorkerLink } from './sessionLink.ts';
import type { startPhysicsWorker } from '../sessionWorker.ts';
import type { createSoftVertices } from '../softBodies.ts';
import type { createStepClock } from '../stepClock.ts';
import type { createTileStreamer } from '../tiles.ts';
import type { createPhysicsVehicles } from '../vehicles.ts';
import type { createPhysicsView } from '../view.ts';

/** The joints and vehicles `world.physics.add` holds: made once their bodies are simulated. */
export type WantedPhysics = Pick<ReturnType<typeof createJointList>, 'joints' | 'vehicles'>;

/** What one session is made of, handed to the parts that drive it (`session.ts`). */
export interface SessionParts {
  root: Object3D;
  budget: Readonly<PhysicsBudget>;
  invalidate: () => void;
  failed: (error: EngineError, fatal?: boolean) => void;
  wanted: WantedPhysics;
  s: SessionState;
  link: WorkerLink;
  writer: CommandWriter;
  clock: ReturnType<typeof createStepClock>;
  stale: Set<Object3D>;
  poses: ReturnType<typeof createPhysicsPoses>;
  bodies: ReturnType<typeof createPhysicsBodies>;
  joints: ReturnType<typeof createPhysicsJoints>;
  vehicles: ReturnType<typeof createPhysicsVehicles>;
  soft: ReturnType<typeof createSoftVertices>;
  view: ReturnType<typeof createPhysicsView>;
  stats: PhysicsStats;
  /** The character's inner capsule is the slot past the page's; its contacts name the camera. */
  touched: { id: number; eye: Object3D | null };
  worker: ReturnType<typeof startPhysicsWorker>;
  tiles: ReturnType<typeof createTileStreamer>;
  casts: Map<number, (hits: Uint32Array) => void>;
  character: ReturnType<typeof createCharacterPort>;
  /** A body leaves: its joints and vehicles with it; out for good, they break. */
  retire: (index: number, forGood?: boolean) => void;
  onReady: () => void;
  /** The worker said it is ready. */
  started: Promise<void>;
}
