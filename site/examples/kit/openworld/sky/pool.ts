/**
 * A fixed pool of particles in flat arrays: no allocation after creation, live particles
 * packed at the front, a spawn beyond capacity dropped. What the pool costs is set by its
 * capacity, never by how many emitters ask.
 */

/** How a particle moves: thrown and blown, circling its origin, or wandering around it. */
export type Motion = 'ballistic' | 'orbit' | 'wander';

/** The forces of one step, shared by every particle of a pool. */
export type Forces = {
  /** Vertical acceleration, m/s² (gravity down is negative, buoyant smoke positive). */
  lift: number;
  /** How fast velocity relaxes to the wind, 1/s (1 / the particle's response time). */
  drag: number;
  /** The wind at the particles, m/s. */
  wind: { x: number; z: number };
};

export type Pool = {
  readonly capacity: number;
  /** Live particles: indices `0 … alive − 1`. */
  alive: number;
  readonly position: Float32Array;
  readonly velocity: Float32Array;
  readonly origin: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly phase: Float32Array;
};

export function createPool(capacity: number): Pool {
  return {
    capacity,
    alive: 0,
    position: new Float32Array(capacity * 3),
    velocity: new Float32Array(capacity * 3),
    origin: new Float32Array(capacity * 3),
    age: new Float32Array(capacity),
    life: new Float32Array(capacity),
    phase: new Float32Array(capacity),
  };
}

/** Adds one particle at `at` with velocity `v`; false when the pool is full (it is dropped). */
export function spawn(
  pool: Pool,
  at: readonly [number, number, number],
  v: readonly [number, number, number],
  life: number,
  phase: number,
): boolean {
  if (pool.alive >= pool.capacity) return false;
  const i = pool.alive++;
  pool.position.set(at, i * 3);
  pool.origin.set(at, i * 3);
  pool.velocity.set(v, i * 3);
  pool.age[i] = 0;
  pool.life[i] = life;
  pool.phase[i] = phase;
  return true;
}

/** Moves the last live particle into slot `i`: removal in constant time, the front packed. */
function remove(pool: Pool, i: number) {
  const last = --pool.alive;
  if (i === last) return;
  pool.position.copyWithin(i * 3, last * 3, last * 3 + 3);
  pool.velocity.copyWithin(i * 3, last * 3, last * 3 + 3);
  pool.origin.copyWithin(i * 3, last * 3, last * 3 + 3);
  pool.age[i] = pool.age[last];
  pool.life[i] = pool.life[last];
  pool.phase[i] = pool.phase[last];
}

/**
 * Advances every live particle by `dt` seconds and retires those past their life. `radius`
 * and `rate` shape the circling and wandering motions (metres, radians per second).
 */
export function step(
  pool: Pool,
  dt: number,
  motion: Motion,
  forces: Forces,
  shape: { radius: number; rate: number },
): void {
  const { position: p, velocity: v, origin: o } = pool;
  for (let i = pool.alive - 1; i >= 0; i--) {
    pool.age[i] += dt;
    if (pool.age[i] >= pool.life[i]) {
      remove(pool, i);
      continue;
    }
    const k = i * 3;
    if (motion === 'ballistic') {
      const relax = Math.min(1, forces.drag * dt);
      v[k] += (forces.wind.x - v[k]) * relax;
      // The air is still vertically: drag alone bounds the fall at lift / drag.
      v[k + 1] += forces.lift * dt - v[k + 1] * relax;
      v[k + 2] += (forces.wind.z - v[k + 2]) * relax;
      p[k] += v[k] * dt;
      p[k + 1] += v[k + 1] * dt;
      p[k + 2] += v[k + 2] * dt;
      continue;
    }
    const angle = pool.phase[i] + pool.age[i] * shape.rate;
    if (motion === 'orbit') {
      p[k] = o[k] + Math.cos(angle) * shape.radius;
      p[k + 1] = o[k + 1] + Math.sin(angle * 0.5) * shape.radius * 0.1;
      p[k + 2] = o[k + 2] + Math.sin(angle) * shape.radius;
    } else {
      p[k] = o[k] + Math.sin(angle * 1.3 + pool.phase[i]) * shape.radius;
      p[k + 1] = o[k + 1] + Math.sin(angle * 0.7) * shape.radius * 0.3;
      p[k + 2] = o[k + 2] + Math.cos(angle * 0.9 - pool.phase[i]) * shape.radius;
    }
  }
}
