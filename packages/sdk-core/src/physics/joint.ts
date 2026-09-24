import type { Vec3Input } from '../world/math/vector3.ts';
import type { Object3D } from '../world/object/object3d.ts';

/** The joints between bodies, each one of Jolt's own constraints. */
export type JointKind = 'fixed' | 'point' | 'hinge' | 'slider' | 'distance' | 'cone';

/** How far a joint may move: radians for a hinge, metres for a slider or a distance, the cone's
 *  half angle (`max`) for a cone. */
export interface JointLimits {
  /** A hinge's from −π to 0, a slider's 0 or below. */ min?: number;
  /** A hinge's from 0 to π, a slider's 0 or above. */ max?: number;
}

/** A hinge's or a slider's motor: it drives the joint to a velocity or to a position. */
export interface JointMotor {
  /** `'velocity'`: rad/s or m/s; `'position'`: radians or metres from where the joint was made. */
  mode: 'velocity' | 'position';
  target: number;
  /** N·m for a hinge, N for a slider; left out, no bound. */ maxForce?: number;
}

/** What `joint.*` accepts. Points and axes are in the world, read when the joint is first made. */
export interface JointOptions {
  /** Where the bodies connect: the hinge's pin, the ball of a point joint, the end of a distance
   *  on `a`. @defaultValue a's position */
  anchor?: Vec3Input;
  /** The end of a distance on `b`. @defaultValue b's position, or `anchor` with the world */
  anchorB?: Vec3Input;
  /** A hinge's pin, a slider's rail, a cone's middle. @defaultValue [0, 1, 0] */
  axis?: Vec3Input;
  /** Hinge, slider, distance and cone: how far it moves. A distance's default is its length. */
  limits?: JointLimits;
  /** Hinge, slider and distance: past the limits, a spring pulls it back instead of a wall;
   *  `frequency` in Hz, `damping` from 0 (none) to 1 (critical). */
  spring?: { frequency: number; damping?: number };
  /** Hinge and slider: a motor, changed at any time through `joint.motor`. */
  motor?: JointMotor | null;
  /** Newtons of pull past which the joint breaks; left out, never. */
  breakForce?: number;
}

/** The world's side of a joint: what a write on it asks of the simulation. */
export interface JointHost {
  /** The motor changed. */
  motor(joint: Joint): void;
}

/** The tunings each kind has. */
const ALL = ['limits', 'spring', 'motor'] as const;
type Tuning = (typeof ALL)[number];
const TUNINGS: Record<JointKind, readonly Tuning[]> = {
  fixed: [],
  point: [],
  hinge: ALL,
  slider: ALL,
  distance: ['limits', 'spring'],
  cone: ['limits'],
};
const refuse = (kind: JointKind, tuning: Tuning) => {
  if (!TUNINGS[kind].includes(tuning)) throw new RangeError(`A ${kind} joint has no ${tuning}.`);
};

/**
 * A joint between two bodies, or a body and the world (`b` null), made by `joint.*` and added to
 * the simulation by `world.physics.add`. It holds while both bodies are simulated, and until it
 * breaks.
 */
export class Joint {
  private _motor: JointMotor | null;
  private _broken = false;
  private readonly handlers = new Set<() => void>();
  /** The world simulating this joint, set while it does. */ _host: JointHost | null = null;
  /** The joint's id in the simulation (slot and generation), -1 outside one. */ _id = -1;
  /** Each end's `point, axis, normal` in its body's frame, fixed when first made. */
  _frames: { a: number[]; b: number[]; length: number } | null = null;

  /** What the joint is. */ readonly kind: JointKind;
  /** The first body. */ readonly a: Object3D;
  /** The second body, or `null` for the world. */ readonly b: Object3D | null;
  /** What it was made with. */ readonly options: Readonly<JointOptions>;

  constructor(kind: JointKind, a: Object3D, b: Object3D | null, options: JointOptions = {}) {
    this.kind = kind;
    this.a = a;
    this.b = b;
    this.options = options;
    if (a === b) throw new RangeError('A joint connects two different bodies.');
    for (const tuning of ALL) if (options[tuning] != null) refuse(kind, tuning);
    this._motor = options.motor ?? null;
  }
  /** The motor, a hinge's or a slider's; `null` lets the joint turn or slide freely. */
  get motor() {
    return this._motor;
  }
  set motor(motor: JointMotor | null) {
    if (motor) refuse(this.kind, 'motor');
    this._motor = motor;
    this._host?.motor(this);
  }
  /** Whether it broke: pulled past its `breakForce`. A broken joint holds no more. */
  get broken() {
    return this._broken;
  }
  /**
   * Calls `handler` when the joint breaks.
   * @returns A function that removes the handler.
   */
  on(event: 'break', handler: () => void) {
    this.handlers.add(handler);
    return () => void this.handlers.delete(handler);
  }
  /** The simulation broke it. */
  _break() {
    if (this._broken) return;
    this._broken = true;
    for (const handler of this.handlers) handler();
  }
}

type Make = (a: Object3D, b: Object3D | null, options?: JointOptions) => Joint;
const make =
  (kind: JointKind): Make =>
  (a, b, options) =>
    new Joint(kind, a, b, options);

/** The `joint` family: two bodies connected, or a body and the world (`b` null). */
export const joint = {
  /** Welds them: they move as one. */
  fixed: make('fixed'),
  /** A ball joint at `anchor`: they turn freely around it. */
  point: make('point'),
  /** A pin at `anchor` along `axis`: a door, a wheel. `limits` in radians. */
  hinge: make('hinge'),
  /** A rail along `axis`: a drawer, a piston. `limits` in metres. */
  slider: make('slider'),
  /** Keeps `anchor` on `a` and `anchorB` on `b` apart by their length, or within `limits`. */
  distance: make('distance'),
  /** A ball joint whose `axis` swings within a cone of half angle `limits.max`. */
  cone: make('cone'),
};
