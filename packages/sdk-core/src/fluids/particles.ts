/**
 * The engine's particle pool (#420), the one the renderers step on the GPU: a fixed capacity, a
 * ring where emission writes the oldest slot, and the frame's emission records staged in one
 * buffer made at creation. Nothing is compacted and nothing is read back: a particle whose age
 * reached its lifetime is dead, and the GPU skips it. The CPU only stages records and hands each
 * image its step (`flush`), which the renderer's particle step reads (`sdk-browser/src/particles/`).
 * Positions are kept relative to the pool's origin, its emitter's place in the world: a particle
 * ten kilometres out still moves by a fraction of a millimetre, which a 32-bit world coordinate
 * would round away. The motion is the same wherever the origin is, so the step never reads it;
 * drawing adds it back (#755).
 */
import { GRAVITY_PRESETS } from '../physics/options.ts';

/** Floats of one particle and of one emission record, the same eight words: position from the
 *  origin then age, velocity then lifetime. A record's age is zero: the GPU copies it as it is. */
export const PARTICLE_FLOATS = 8;
/** The largest pool: 32 MiB of state on WebGPU, a 1024 × 1024 texture pair on WebGL2. */
const MAX_CAPACITY = 1 << 20;
/** The longest step an image takes, seconds: a stalled tab does not fling its particles away. */
const MAX_STEP = 1 / 15;

/** How a pool is made; the capacity is fixed for its life. */
export interface ParticlePoolSpec {
  /** Particles the pool holds; emission past it overwrites the oldest. */
  capacity: number;
  /** Records one image may stage; by default a capacity's sixty-fourth, 256 at least, the
   *  capacity at most. */
  emitPerFrame?: number;
  /** Metres per second squared on every live particle; gravity by default. */
  acceleration?: readonly [number, number, number];
  /** The emitter's place in the world, metres, fixed for the pool's life; the world origin by
   *  default. */
  origin?: readonly [number, number, number];
}

/** What one image does with a pool: `count` records land from ring slot `first`, then every
 *  live particle moves by `dt` seconds. */
export type ParticleStep = { first: number; count: number; dt: number };

export class ParticlePool {
  readonly capacity: number;
  readonly emitPerFrame: number;
  readonly acceleration: Float32Array;
  /** The origin in double precision: emission subtracts it before rounding to 32 bits. */
  readonly origin: Float64Array;
  /** The staged records, `emitPerFrame` of them, read by the renderer up to `step.count`. */
  readonly staging: Float32Array<ArrayBuffer>;
  /** Records staged since creation, and those refused: the image's staging full, or the pool
   *  `refused` by a renderer that cannot step it, which it then no longer asks frames for. */
  emitted = 0;
  dropped = 0;
  refused = false;
  private readonly step: ParticleStep = { first: 0, count: 0, dt: 0 };
  private cursor = 0;
  private staged = 0;
  private pending = 0;
  /** Seconds the longest-lived particle still has, as far as the CPU knows: it never reads back. */
  private liveFor = 0;

  constructor({ capacity, emitPerFrame, acceleration, origin }: ParticlePoolSpec) {
    const perFrame = emitPerFrame ?? Math.min(capacity, Math.max(256, capacity >> 6));
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY)
      throw new Error(`PARTICLE_CAPACITY: a pool holds 1 to ${MAX_CAPACITY} particles`);
    if (!Number.isInteger(perFrame) || perFrame < 1 || perFrame > capacity)
      throw new Error('PARTICLE_EMISSION: a pool stages 1 to `capacity` records a frame');
    this.capacity = capacity;
    this.emitPerFrame = perFrame;
    this.acceleration = Float32Array.from(acceleration ?? [0, -GRAVITY_PRESETS.earth, 0]);
    this.origin = Float64Array.from(origin ?? [0, 0, 0]);
    this.staging = new Float32Array(perFrame * PARTICLE_FLOATS);
  }

  /** Stages one particle at world position `x, y, z`, born at the next image; false, and
   *  counted, when the image's staging is full. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, lifetime: number) {
    if (this.refused || this.staged === this.emitPerFrame) {
      this.dropped++;
      return false;
    }
    const at = this.staged++ * PARTICLE_FLOATS,
      words = this.staging,
      origin = this.origin;
    words[at] = x - origin[0];
    words[at + 1] = y - origin[1];
    words[at + 2] = z - origin[2];
    words[at + 3] = 0;
    words[at + 4] = vx;
    words[at + 5] = vy;
    words[at + 6] = vz;
    words[at + 7] = lifetime;
    this.liveFor = Math.max(this.liveFor, lifetime);
    this.emitted++;
    return true;
  }

  /** Whether the next step changes anything: a record staged, or a particle still alive. An idle
   *  pool neither dispatches nor keeps the image from being held. */
  get moving() {
    return !this.refused && (this.staged > 0 || this.liveFor > 0);
  }

  /** Adds `seconds` to the time the next image steps; an idle pool lets them pass untaken, so
   *  a held image's time never flings the next newborn particles. */
  advance(seconds: number) {
    if (this.moving) this.pending += seconds;
  }

  /** The step of the image being encoded, always the same object: the staged records take the
   *  ring's next slots, and the time advanced since the last step, clamped, is consumed; an idle
   *  pool's step takes no time. */
  flush(): Readonly<ParticleStep> {
    const step = this.step;
    step.first = this.cursor;
    step.count = this.staged;
    step.dt = Math.min(this.pending, MAX_STEP);
    this.liveFor -= step.dt;
    this.cursor = (this.cursor + this.staged) % this.capacity;
    this.staged = 0;
    this.pending = 0;
    return step;
  }
}
