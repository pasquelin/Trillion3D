import test from 'node:test'
import assert from 'node:assert/strict'
import { PARTICLE_FLOATS, ParticlePool } from './particles.ts'
import { ParticleEmitter } from './emitter.ts'

const emitMany = (pool: ParticlePool, n: number) => {
  for (let i = 0; i < n; i++) pool.emit(i, 0, 0, 0, 1, 0, 2)
}

test('a record is the particle as the GPU keeps it: position, age zero, velocity, lifetime, look', () => {
  const pool = new ParticlePool({
    capacity: 8,
    emitPerFrame: 4,
    size: 0.3,
    color: [1, 0.5, 0.25, 1],
  })
  assert.equal(pool.emit(1, 2, 3, 4, 5, 6, 7), true)
  const of = (n: number) => [
    ...pool.staging.subarray(n * PARTICLE_FLOATS, (n + 1) * PARTICLE_FLOATS),
  ]
  // A particle born with no look of its own takes the pool's size and colour, no turn.
  const rest = [1, 2, 3, 0, 4, 5, 6, 7, 0.3, 0.3, 0, 0, 1, 0.5, 0.25, 1].map(Math.fround)
  assert.deepEqual(of(0), rest)
  // One born with its own: a size by half width and half height, a turn, a colour.
  pool.emit(1, 2, 3, 4, 5, 6, 7, { size: [0.5, 2], rotation: 1.5, color: [0, 1, 0, 0.5] })
  assert.deepEqual(of(1).slice(8), [0.5, 2, 1.5, 0, 0, 1, 0, 0.5])
  pool.emit(1, 2, 3, 4, 5, 6, 7, { size: 4 })
  assert.deepEqual(of(2).slice(8, 12), [4, 4, 0, 0])
  pool.advance(0.01)
  assert.deepEqual({ ...pool.flush() }, { first: 0, count: 3, dt: 0.01 })
})

test('the ring wraps past capacity onto the oldest slots, and allocates nothing after creation', () => {
  const pool = new ParticlePool({ capacity: 8, emitPerFrame: 4 })
  const staging = pool.staging,
    step = pool.flush(),
    slots = []
  for (const n of [4, 4, 3, 2]) {
    emitMany(pool, n)
    assert.equal(pool.flush(), step, 'the same step object every image')
    slots.push(`${step.first}+${step.count}`)
  }
  // Slots 0..3, 4..7, then 0..2 overwrite the first image's particles, then 3..4.
  assert.deepEqual(slots, ['0+4', '4+4', '0+3', '3+2'])
  assert.equal(pool.staging, staging, 'the same staging')
  assert.equal(pool.emitted, 13)
})

test('a full staging refuses and counts; the step clamps its time and consumes it', () => {
  const pool = new ParticlePool({ capacity: 8, emitPerFrame: 2 })
  emitMany(pool, 3)
  assert.equal(pool.dropped, 1)
  pool.advance(1)
  assert.deepEqual({ ...pool.flush() }, { first: 0, count: 2, dt: 1 / 15 })
  assert.deepEqual({ ...pool.flush() }, { first: 2, count: 0, dt: 0 }, 'nothing twice')
})

test('a pool out of bounds is refused by name', () => {
  assert.throws(() => new ParticlePool({ capacity: 0 }), /^Error: PARTICLE_CAPACITY/)
  assert.equal(new ParticlePool({ capacity: 64 }).emitPerFrame, 64, 'the default, at most it')
  assert.equal(new ParticlePool({ capacity: 1 << 14 }).emitPerFrame, 1024, 'a sixteenth')
  // The device bounds a pool (the renderer's refusal), no texture size: past 2^20 it is made.
  assert.equal(new ParticlePool({ capacity: 2 ** 21, emitPerFrame: 1 }).capacity, 2 ** 21)
  assert.throws(() => new ParticlePool({ capacity: 2 ** 31 + 1 }), /^Error: PARTICLE_CAPACITY/)
  assert.throws(
    () => new ParticlePool({ capacity: 4, emitPerFrame: 5 }),
    /^Error: PARTICLE_EMISSION/,
  )
})

test('a particle ten kilometres out keeps its sub-millimetre steps: positions are from the origin', () => {
  const far = 10_000,
    pool = new ParticlePool({ capacity: 8, origin: [far, 0, far] })
  pool.emit(far + 0.5, 2, far, 0.024, 0, 0, 4)
  assert.deepEqual([...pool.staging.subarray(0, 3)], [0.5, 2, 0])
  // A drift of 0.4 mm in one step of 1/60 s, in the GPU step's 32-bit arithmetic: x += vx × dt.
  const step = (x: number) => Math.fround(x + Math.fround(0.024 * Math.fround(1 / 60)))
  assert.ok(step(pool.staging[0]) > pool.staging[0], 'from the origin, the step is kept')
  assert.equal(step(Math.fround(far + 0.5)), Math.fround(far + 0.5), 'in world floats, lost')
})

test('an idle pool stops moving: its step takes no time once its last particle is dead', () => {
  const pool = new ParticlePool({ capacity: 8 })
  assert.equal(pool.moving, false, 'nothing emitted')
  pool.emit(0, 0, 0, 0, 0, 0, 0.1)
  assert.equal(pool.moving, true)
  for (const dt of [0.05, 0.05, 0.05, 0.05]) {
    pool.advance(dt)
    assert.equal(pool.flush().dt, dt)
  }
  assert.equal(pool.moving, false, 'the lifetime has run out')
  pool.advance(0.05)
  assert.equal(pool.flush().dt, 0)
})

test('a pool blends, sizes and softens as told, and refuses by name what no renderer draws', () => {
  const fire = new ParticlePool({ capacity: 8 })
  assert.deepEqual([fire.blend, fire.size, fire.softness], ['additive', 0.1, 0.1])
  assert.deepEqual([...fire.fade], [1, 1, 1, 1], 'no fade of its own: the colour holds to death')
  assert.deepEqual([...new ParticlePool({ capacity: 8, fade: [0, 0, 0, 0] }).fade], [0, 0, 0, 0])
  const smoke = new ParticlePool({ capacity: 8, blend: 'premultiplied', size: 2 })
  assert.deepEqual([smoke.blend, smoke.softness], ['premultiplied', 2], 'soft over its size')
  const blend = 'alpha' as ParticlePool['blend']
  assert.throws(() => new ParticlePool({ capacity: 8, blend }), /^Error: PARTICLE_BLEND/)
  assert.throws(() => new ParticlePool({ capacity: 8, softness: 0 }), /^Error: PARTICLE_SIZE/)
  const color = [1, 1, 1] as unknown as [number, number, number, number]
  assert.throws(() => new ParticlePool({ capacity: 8, color }), /^Error: PARTICLE_COLOR/)
  assert.throws(() => new ParticlePool({ capacity: 8, fade: color }), /^Error: PARTICLE_COLOR/)
})

test('an emitter spawns its rate over the images, the fraction owed carried, and a burst at once', () => {
  const emitter = new ParticleEmitter({
    capacity: 64,
    rate: 30,
    lifetime: [1, 2],
    speed: 2,
    seed: 7,
  })
  for (let i = 0; i < 10; i++) emitter.advance(1 / 60)
  assert.equal(emitter.pool.emitted, 5, 'ten images of a sixtieth at thirty a second')
  emitter.burst(3)
  assert.equal(emitter.pool.emitted, 8)
  emitter.update({ active: false })
  emitter.advance(1)
  assert.equal(emitter.pool.emitted, 8, 'inactive: no rate')
})

test('an emitter sends its particles inside the cone about its direction', () => {
  const emitter = new ParticleEmitter({
    capacity: 256,
    emitPerFrame: 256,
    direction: [0, 0, 2],
    spread: 0.3,
    speed: 3,
  })
  emitter.burst(200)
  for (let n = 0; n < 200; n++) {
    const at = n * PARTICLE_FLOATS,
      v = emitter.pool.staging.subarray(at + 4, at + 7)
    assert.ok(Math.abs(Math.hypot(v[0], v[1], v[2]) - 3) < 1e-4, 'the speed')
    assert.ok(v[2] / 3 >= Math.cos(0.3) - 1e-5, 'inside the cone')
  }
  assert.throws(() => emitter.update({ spread: 4 }), /PARTICLE_SPREAD/)
  assert.throws(() => emitter.update({ lifetime: 0 }), /PARTICLE_SPAWN/)
})
