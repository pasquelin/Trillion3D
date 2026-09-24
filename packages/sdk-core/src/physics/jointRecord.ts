/** One joint as the JOINT command carries it (`layout.ts` JOINT_WORDS). */
export interface JointRecord {
  /** The joint's slot and generation. */ id: number;
  /** `JOINT`. */ kind: number;
  /** The bodies' engine ids; `MISS` for the world. */ a: number;
  b: number;
  /** Each end's `point, axis, normal`, nine numbers in its body's own frame. */
  frameA: readonly number[];
  frameB: readonly number[];
  /** `limit min, limit max, spring frequency, spring damping`. */ limits: readonly number[];
  /** `MOTOR` mode, target and max force (0: no bound). */
  motor: { mode: number; target: number; maxForce: number };
  /** Newtons past which it breaks; 0 never. */ breakForce: number;
}
