import { Vector3 } from '../world/math/vector3.ts';
import { listen } from '../world/math/observed.ts';
import type { Object3D } from '../world/object/object3d.ts';
import { DAMPING } from './layout.ts';
import type { PhysicsBodyOptions, PhysicsOption, PhysicsShape, PhysicsType } from './options.ts';

/** What a contact hands its listeners: the other object, the impulse and where it touched. */
export interface ContactEvent {
  /** The object touched, the camera when the character touched it; `null` once it has left the
   *  scene. */
  other: Object3D | null;
  /** N·s: the approach speed along the normal times the pair's reduced mass, estimated before
   *  the solver runs; 0 on `leave`. */
  impulse: number;
  /** The contact point, world frame; the origin on `leave`. */
  point: { x: number; y: number; z: number };
}
/** The events a body reports: first touch with an impulse (`contact`), and touch begun or ended. */
export type ContactEventName = 'contact' | 'enter' | 'leave';

/** The world's side of a body: what a write on `obj.physics` asks of the simulation. */
export interface PhysicsHost {
  /** A setting the body was created with changed: it is created again. */
  rebuild(body: ObjectPhysics): void;
  /** Friction, restitution or gravity scale changed. */
  tune(body: ObjectPhysics): void;
  /** The velocity was written. */
  velocity(body: ObjectPhysics): void;
  /** An impulse was applied. */
  impulse(body: ObjectPhysics, x: number, y: number, z: number): void;
  /** The body was woken. */
  wake(body: ObjectPhysics): void;
  /** Whether contact events are wanted changed. */
  listened(body: ObjectPhysics): void;
}

/**
 * The physics of one object, as `obj.physics` holds it once set: a live record of what the body is
 * and does. Writes reach the simulation at the next step; `velocity` reads what the last step left.
 */
export class ObjectPhysics {
  /** How the body moves; set `obj.physics` again to change it. */ readonly type: PhysicsType;
  /** The declared shape, when one was. */ readonly shape?: PhysicsShape;
  /** Whether the body only reports contacts. */ readonly sensor: boolean;
  /** Whether continuous collision is on. */ readonly ccd: boolean;
  /** Whether the body is decorative debris. */ readonly decorative: boolean;
  /** The share of its speed lost per second by itself, linear and angular (`dv/dt = −c·v`). */
  readonly damping: { readonly linear: number; readonly angular: number };
  private readonly _velocity = new Vector3();
  private _asleep = false;
  /** The tick the velocity was last read from. */
  private _seen = 0;
  private _mass: number | undefined;
  private _gravityScale: number;
  private _friction: number | undefined;
  private _restitution: number | undefined;
  private readonly handlers = new Map<ContactEventName, Set<(event: ContactEvent) => void>>();
  /** The world simulating this body, set while it does. */ _host: PhysicsHost | null = null;
  /** The body's slot in the simulation, -1 outside one. */ _index = -1;
  /** Where its world keeps its bodies' last step, by slot (flat arrays written by the
   *  thousand), while simulated. */
  _state: {
    /** 1 where the body sleeps. */ asleep: Uint8Array;
    /** Six numbers per slot: the linear velocity, then the angular one. */ velocity: Float32Array;
    /** The tick that last wrote each slot, from 1. */ stamp: Uint32Array;
  } | null = null;

  constructor(option: PhysicsOption) {
    const o: PhysicsBodyOptions = typeof option === 'string' ? { type: option } : option;
    this.type = o.type ?? 'dynamic';
    this.shape = o.shape;
    this.sensor = o.sensor ?? false;
    this.ccd = o.ccd ?? false;
    this.decorative = o.decorative ?? false;
    const { linear = DAMPING, angular = DAMPING } = o.damping ?? {};
    if (!(linear >= 0 && angular >= 0))
      throw new RangeError(`A body's damping is 0 and up: ${linear} linear, ${angular} angular.`);
    this.damping = { linear, angular };
    this._mass = o.mass;
    this._gravityScale = o.gravityScale ?? 1;
    this._friction = o.friction;
    this._restitution = o.restitution;
    listen(this._velocity, () => this._host?.velocity(this));
  }
  /** Linear velocity, m/s, as the last step left it; write it to launch the body. */
  get velocity(): Vector3 {
    this.read();
    return this._velocity;
  }
  /** Reads the velocity from the world's arrays when a step wrote them since it was last read. */
  private read() {
    const state = this._state,
      i = this._index;
    if (!state || state.stamp[i] === this._seen) return;
    this._seen = state.stamp[i];
    const e = this._velocity.elements;
    for (let k = 0; k < 3; k++) e[k] = state.velocity[i * 6 + k];
  }
  /** Whether the body sleeps: at rest, and simulated no more until something wakes it. */
  get asleep() {
    return this._state ? this._state.asleep[this._index] === 1 : this._asleep;
  }
  /** Simulated by `host` in slot `index`, its last step kept in `state`. */
  _attach(host: PhysicsHost, index: number, state: NonNullable<ObjectPhysics['_state']>) {
    this._host = host;
    this._index = index;
    this._state = state;
    this._seen = state.stamp[index];
  }
  /** Out of the simulation: the last step read is kept. */
  _detach() {
    this._asleep = this.asleep;
    this.read();
    this._host = this._state = null;
    this._index = -1;
  }
  /** Mass in kilograms; `undefined` takes the material's density times the volume. */
  get mass() {
    return this._mass;
  }
  set mass(kg: number | undefined) {
    this._mass = kg;
    this._host?.rebuild(this);
  }
  /** Multiplies the world's gravity for this body. @defaultValue 1 */
  get gravityScale() {
    return this._gravityScale;
  }
  set gravityScale(scale: number) {
    this._gravityScale = scale;
    this._host?.tune(this);
  }
  /** Friction override; `undefined` takes the material's. */
  get friction() {
    return this._friction;
  }
  set friction(value: number | undefined) {
    this._friction = value;
    this._host?.tune(this);
  }
  /** Restitution override; `undefined` takes the material's. */
  get restitution() {
    return this._restitution;
  }
  set restitution(value: number | undefined) {
    this._restitution = value;
    this._host?.tune(this);
  }
  /** Pushes the body at once, an impulse in N·s through its centre of mass; wakes it. */
  applyImpulse(x: number | { x: number; y: number; z: number }, y = 0, z = 0) {
    if (typeof x === 'number') this._host?.impulse(this, x, y, z);
    else this._host?.impulse(this, x.x, x.y, x.z);
  }
  /** Wakes the body, asleep or not. */
  wake() {
    this._host?.wake(this);
  }
  /**
   * Calls `handler` on a contact event of this body.
   * @returns A function that removes the handler.
   * @example box.physics.on('contact', (e) => console.log(e.impulse));
   */
  on(event: ContactEventName, handler: (event: ContactEvent) => void) {
    const wanted = this.listens;
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    if (!wanted) this._host?.listened(this);
    return () => {
      set.delete(handler);
      if (!this.listens) this._host?.listened(this);
    };
  }
  /** Whether any contact handler is set. */
  get listens() {
    for (const set of this.handlers.values()) if (set.size) return true;
    return false;
  }
  /** Hands an event to this body's handlers. */
  _emit(name: ContactEventName, event: ContactEvent) {
    for (const handler of this.handlers.get(name) ?? []) handler(event);
  }
}
