import type { Object3D } from '../world/object/object3d.ts';
import type { JointKind, JointMotor, JointOptions } from './jointOptions.ts';

export type {
  JointKind,
  JointLimits,
  JointMotor,
  JointOptions,
  SixDofAxis,
} from './jointOptions.ts';

/** The options each kind has, past `anchor`, `anchorB`, `axis` and `breakForce`. */
const ALL = ['limits', 'spring', 'motor'] as const;
type Tuning =
  (typeof ALL)[number] | 'axes' | 'axisB' | 'path' | 'loop' | 'follow' | 'over' | 'ratio';
const TUNINGS: Record<JointKind, readonly Tuning[]> = {
  fixed: [],
  point: [],
  hinge: ALL,
  slider: ALL,
  distance: ['limits', 'spring'],
  cone: ['limits'],
  swingTwist: ['limits', 'motor'],
  sixDof: ['axes', 'spring', 'motor'],
  path: ['path', 'loop', 'follow', 'motor'],
  pulley: ['over', 'ratio', 'limits'],
  gear: ['axisB', 'ratio'],
  rackAndPinion: ['axisB', 'ratio'],
};
const OPTIONS = [...new Set(Object.values(TUNINGS).flat())];
const refuse = (kind: JointKind, tuning: Tuning) => {
  if (!TUNINGS[kind].includes(tuning)) throw new RangeError(`A ${kind} joint has no ${tuning}.`);
};
/** What a kind cannot be made without: a second body, a track, the wheels. */
function required(kind: JointKind, b: Object3D | null, options: JointOptions) {
  if (!b && (kind === 'pulley' || kind === 'gear' || kind === 'rackAndPinion'))
    throw new RangeError(`A ${kind} joint connects two bodies.`);
  if (kind === 'path' && (options.path?.length ?? 0) < 2)
    throw new RangeError('A path joint needs a path of two points or more.');
  if (kind === 'pulley' && !options.over) throw new RangeError('A pulley joint needs its wheels.');
}

/**
 * A joint between two bodies, or a body and the world (`b` null), made by `joint.*` and added to
 * the simulation by `world.physics.add`. It holds while both bodies are simulated, and until it
 * breaks.
 */
export class Joint {
  private _motor: JointMotor | null;
  private _broken = false;
  private readonly handlers = new Set<() => void>();
  /** The world simulating this joint, set while it does: what a write on it asks of the
   *  simulation — the motor changed. */
  _host: { motor(joint: Joint): void } | null = null;
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
    for (const tuning of OPTIONS) if (options[tuning] != null) refuse(kind, tuning);
    required(kind, b, options);
    this._motor = options.motor ?? null;
  }
  /** The motor of a hinge, a slider, a swing-twist, a six-DOF or a path; `null` lets the joint
   *  move freely. */
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

const make = (kind: JointKind) => (a: Object3D, b: Object3D | null, options?: JointOptions) =>
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
  /** A shoulder: `axis` swings within a cone of half angle `limits.swing` and twists about
   *  itself between `limits.min` and `max`; its motor drives the twist. */
  swingTwist: make('swingTwist'),
  /** Six axes, each locked, free or limited (`axes`): any joint in between the others. */
  sixDof: make('sixDof'),
  /** `a` runs along a smooth track through `path`, fixed to `b` or the world: a roller coaster. */
  path: make('path'),
  /** A rope from `a` over two wheels (`over`) down to `b`: one rises as the other falls. */
  pulley: make('pulley'),
  /** Two wheels turning together by `ratio`, each about its own pin (`axis`, `axisB`); each
   *  needs its own hinge to hold it in place. */
  gear: make('gear'),
  /** A pinion `a` turning about `axis` drives a rack `b` along `axisB`; each needs its own
   *  hinge or slider to hold it in place. */
  rackAndPinion: make('rackAndPinion'),
};
