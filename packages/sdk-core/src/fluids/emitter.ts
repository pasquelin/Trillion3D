/**
 * A PARTICLE EMITTER: the part of an effect that decides when particles are born and with what
 * motion, over a pool that holds and steps them (`./particles.ts`). It spawns `rate` particles a
 * second (the fraction owed carried to the next image) and any burst the page asks, each with a
 * lifetime, a speed and a direction drawn from the ranges it is given, the direction inside a cone.
 * Its draws come from a seeded generator, so one seed and one clock give one effect.
 */
import { TAU } from '../../../math/src/constants.ts'
import { hypot3 } from '../../../math/src/float/hypot.ts'
import { lerp } from '../../../math/src/scalar/reals.ts'
import { mulberry32, type Random } from '../../../math/src/sequence/random.ts'
import { ParticlePool, type ParticlePoolSpec } from './particles.ts'

/** A number, or the `[min, max]` range one is drawn from, uniformly. */
export type ParticleRange = number | readonly [number, number]

/** What an emitter spawns with: all of it can be changed while it lives (`ParticleEmitter.update`). */
export interface ParticleSpawn {
  /** Particles born a second; 0 by default (only bursts). */
  rate?: number
  /** Seconds a particle lives, drawn from the range; 1 by default. */
  lifetime?: ParticleRange
  /** Metres a second at birth, drawn from the range; 1 by default. */
  speed?: ParticleRange
  /** The cone's axis, any non-zero vector; up, `[0, 1, 0]`, by default. */
  direction?: readonly [number, number, number]
  /** The cone's half angle, radians, 0 to π: 0 sends every particle along `direction`, π in every
   *  direction; 0 by default. */
  spread?: number
  /** Whether the rate spawns; true by default. A burst spawns whatever it says. */
  active?: boolean
}

/** An emitter and its pool: the pool's own spec (`capacity` is required) and the spawn. */
export interface ParticleEmitterSpec extends ParticlePoolSpec, ParticleSpawn {
  /** Seed of the generator the draws come from; 1 by default. */
  seed?: number
}

/** What the emitter spawns with, ready to draw from: the ranges as `[min, max]` and the cosine of the
 *  cone's half angle. */
interface Spawning {
  readonly rate: number
  readonly lifetime: readonly [number, number]
  readonly speed: readonly [number, number]
  readonly direction: readonly [number, number, number]
  readonly spread: number
  readonly cosSpread: number
  readonly active: boolean
}

const rangeOf = (range: ParticleRange): readonly [number, number] =>
  typeof range === 'number' ? [range, range] : [range[0], range[1]]

function checked({ rate, lifetime, speed, direction, spread }: Spawning) {
  if (!(rate >= 0) || !Number.isFinite(rate))
    throw new Error('PARTICLE_RATE: a rate is a finite count of particles a second, 0 or more')
  if (
    !(Number.isFinite(lifetime[0]) && Number.isFinite(lifetime[1])) ||
    !(Number.isFinite(speed[0]) && Number.isFinite(speed[1])) ||
    !(Math.min(lifetime[0], lifetime[1]) > 0)
  )
    throw new Error(
      'PARTICLE_SPAWN: a lifetime is positive and a speed finite, as a number or [min, max]',
    )
  if (direction.length !== 3 || !direction.every(Number.isFinite) || !direction.some(Boolean))
    throw new Error('PARTICLE_DIRECTION: a direction is three finite numbers, not all zero')
  if (!(spread >= 0 && spread <= Math.PI))
    throw new Error('PARTICLE_SPREAD: a cone has a half angle from 0 to π radians')
}

/** `value` unless it is left out. */
const given = <T>(value: T | undefined, held: T) => (value === undefined ? held : value)

export class ParticleEmitter {
  readonly pool: ParticlePool
  private spawn: Spawning
  private readonly random: Random
  private owed = 0
  /** The orthonormal frame `[u, v, axis]` of the cone, nine numbers, made when the direction is set. */
  private readonly frame = new Float64Array(9)

  constructor(spec: ParticleEmitterSpec) {
    this.pool = new ParticlePool(spec)
    this.random = mulberry32(spec.seed ?? 1)
    const spread = spec.spread ?? 0
    this.spawn = {
      rate: spec.rate ?? 0,
      lifetime: rangeOf(spec.lifetime ?? 1),
      speed: rangeOf(spec.speed ?? 1),
      direction: spec.direction ?? [0, 1, 0],
      spread,
      cosSpread: Math.cos(spread),
      active: spec.active ?? true,
    }
    checked(this.spawn)
    this.aim()
  }

  /** Changes what the emitter spawns with, from the next particle on; a field left out stays. */
  update(patch: ParticleSpawn) {
    const held = this.spawn
    const spread = given(patch.spread, held.spread)
    const next: Spawning = {
      rate: given(patch.rate, held.rate),
      lifetime: patch.lifetime === undefined ? held.lifetime : rangeOf(patch.lifetime),
      speed: patch.speed === undefined ? held.speed : rangeOf(patch.speed),
      direction: given(patch.direction, held.direction),
      spread,
      cosSpread: spread === held.spread ? held.cosSpread : Math.cos(spread),
      active: given(patch.active, held.active),
    }
    checked(next)
    this.spawn = next
    this.aim()
  }

  /** Spawns `count` particles now, whatever the rate and `active` say. */
  burst(count: number) {
    for (let i = 0; i < count; i++) this.birth()
  }

  /** Spawns what `seconds` of the rate owe, the fraction carried on; at most one image's staging, so
   *  a stalled frame does not flood the pool. */
  advance(seconds: number) {
    if (!this.spawn.active || this.spawn.rate === 0) return
    this.owed += this.spawn.rate * seconds
    const count = Math.min(Math.floor(this.owed), this.pool.emitPerFrame)
    this.owed = Math.min(this.owed - count, 1)
    this.burst(count)
  }

  private draw(low: number, high: number) {
    return lerp(low, high, this.random())
  }

  private birth() {
    const { lifetime, speed, cosSpread } = this.spawn
    const f = this.frame
    // Uniform over the cone's cap of directions: the cosine of the angle is uniform.
    const cos = 1 - this.random() * (1 - cosSpread),
      sin = Math.sqrt(Math.max(0, 1 - cos * cos)),
      turn = TAU * this.random()
    const a = sin * Math.cos(turn),
      b = sin * Math.sin(turn),
      v = this.draw(speed[0], speed[1])
    const o = this.pool.origin
    this.pool.emit(
      o[0],
      o[1],
      o[2],
      v * (a * f[0] + b * f[3] + cos * f[6]),
      v * (a * f[1] + b * f[4] + cos * f[7]),
      v * (a * f[2] + b * f[5] + cos * f[8]),
      this.draw(lifetime[0], lifetime[1]),
    )
  }

  /** The frame of the cone about the direction. */
  private aim() {
    const [x, y, z] = this.spawn.direction,
      length = hypot3(x, y, z)
    const ax = x / length,
      ay = y / length,
      az = z / length
    // The world axis least along the direction, crossed with it: a stable first tangent.
    const [hx, hy, hz] = Math.abs(ax) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    let ux = ay * hz - az * hy,
      uy = az * hx - ax * hz,
      uz = ax * hy - ay * hx
    const norm = hypot3(ux, uy, uz)
    ux /= norm
    uy /= norm
    uz /= norm
    this.frame.set([
      ux,
      uy,
      uz,
      ay * uz - az * uy,
      az * ux - ax * uz,
      ax * uy - ay * ux,
      ax,
      ay,
      az,
    ])
  }
}
