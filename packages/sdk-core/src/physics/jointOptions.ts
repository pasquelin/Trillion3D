import type { Vec3Input } from '../world/math/vector3.ts';

/** The joints between bodies, each one of Jolt's own constraints. */
export type JointKind =
  | 'fixed'
  | 'point'
  | 'hinge'
  | 'slider'
  | 'distance'
  | 'cone'
  | 'swingTwist'
  | 'sixDof'
  | 'path'
  | 'pulley'
  | 'gear'
  | 'rackAndPinion';

/** A six-DOF joint's axes: slides along `x`, `y`, `z` and turns about them. `x` lies along the
 *  joint's `axis`, `y` as close to the world's up as it can square to it. */
export type SixDofAxis = 'x' | 'y' | 'z' | 'turnX' | 'turnY' | 'turnZ';

/** How far a joint may move: radians for a hinge or a turn, metres for a slider, a distance or a
 *  pulley's rope, the cone's half angle (`max`) for a cone. */
export interface JointLimits {
  /** A hinge's from −π to 0, a slider's 0 or below; a swing-twist's twist from −π. */ min?: number;
  /** A hinge's from 0 to π, a slider's 0 or above; a swing-twist's twist up to π. */ max?: number;
  /** A swing-twist's cone: how far its `axis` swings, a half angle up to π. @defaultValue π */
  swing?: number;
}

/** A joint's motor: it drives the joint to a velocity or to a position. */
export interface JointMotor {
  /** `'velocity'`: rad/s or m/s; `'position'`: radians or metres from where the joint was made —
   *  for a path, the point along it (1.5: halfway between its second and third). */
  mode: 'velocity' | 'position';
  /** The velocity or the position to reach. */ target: number;
  /** N·m for a turn, N for a slide; left out, no bound. */ maxForce?: number;
  /** A six-DOF's axis it drives. @defaultValue 'x' */ axis?: SixDofAxis;
}

/** What `joint.*` accepts. Points and axes are in the world, read when the joint is first made. */
export interface JointOptions {
  /** Where the bodies connect: the hinge's pin, the ball of a point joint, the end of a distance
   *  or of a pulley's rope on `a`. @defaultValue a's position */
  anchor?: Vec3Input;
  /** The end of a distance or of a pulley's rope on `b`. @defaultValue b's position, or `anchor`
   *  with the world */
  anchorB?: Vec3Input;
  /** A hinge's pin, a slider's rail, a cone's or a swing-twist's middle, a six-DOF's `x`, a
   *  gear's or a pinion's pin (`a`). @defaultValue [0, 1, 0]; a six-DOF's [1, 0, 0] */
  axis?: Vec3Input;
  /** A gear's pin on `b`, a rack's rail (`b`). @defaultValue `axis` */
  axisB?: Vec3Input;
  /** Hinge, slider, distance, cone, swing-twist and pulley: how far it moves. A distance's
   *  default is its length, a pulley's rope from 0 to its length. */
  limits?: JointLimits;
  /** A six-DOF's axes that move, freely (`'free'`) or within limits; the others are locked. */
  axes?: Partial<Record<SixDofAxis, JointLimits | 'free'>>;
  /** Hinge, slider, distance and six-DOF: past the limits, a spring pulls it back instead of a
   *  wall; `frequency` in Hz, `damping` from 0 (none) to 1 (critical). */
  spring?: { frequency: number; damping?: number };
  /** Hinge, slider, swing-twist (its twist), six-DOF and path: a motor, changed at any time
   *  through `joint.motor`. */
  motor?: JointMotor | null;
  /** A path's track: at least two points, `b`'s (or the world's) as they stand when made; `a`
   *  starts at the point of it nearest `anchor`. */
  path?: readonly Vec3Input[];
  /** A path's track closes on itself. */ loop?: boolean;
  /** A path's `a` turns with the track, as a cart does, rather than freely, as a bead.
   *  @defaultValue true */
  follow?: boolean;
  /** A pulley's two wheels in the world: `a`'s rope runs up to the first, `b`'s to the second. */
  over?: readonly [Vec3Input, Vec3Input];
  /** A gear's turns of `b` per turn of `a` (the teeth of `a` over those of `b`), the other way
   *  round; a pinion's radians per metre of rack, 1 / its radius; a pulley's metres of `b`'s rope
   *  per metre of `a`'s. @defaultValue 1 */
  ratio?: number;
  /** Newtons of pull past which the joint breaks (N·m of torque between a gear's or a rack's
   *  teeth); left out, never. */
  breakForce?: number;
}
