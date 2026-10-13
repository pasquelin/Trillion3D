import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuTilePool } from './pool.ts'
import { poolLayerBytes, POOL_MAX_LAYERS, tileBytes, TILES_PER_LAYER } from '../../texture/tiles.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'

const rgba = { kind: 'data', lane: 'lossless', format: 'rgba8unorm', texelBytes: 4 } as const

test('the pool allocates its layers once, at the fixed size, and counts its tiles', () => {
  const { device, textures: created } = fakeDevice()
  const pool = createWebgpuTilePool(device, {
    kind: 'color',
    lane: 'lossless',
    format: 'rgba8unorm-srgb',
    texelBytes: 4,
    layers: 2,
  })
  assert.equal(created.length, 1)
  assert.deepEqual(created[0].size, { width: 4096, height: 4096, depthOrArrayLayers: 2 })
  assert.equal(created[0].format, 'rgba8unorm-srgb')
  assert.equal(pool.tiles, 2 * TILES_PER_LAYER)
  assert.equal(pool.bytes, 2 * poolLayerBytes(4))
  assert.ok((created[0].usage & GPUTextureUsage.RENDER_ATTACHMENT) !== 0)
  assert.equal(pool.resident, 0)
  assert.throws(() => createWebgpuTilePool(device, { ...rgba, layers: 0 }), /TEXTURE_POOL_LAYERS/)
  // Past the layers a table entry addresses, a place would name another tile: refused.
  const past = { ...rgba, layers: POOL_MAX_LAYERS + 1 }
  assert.throws(() => createWebgpuTilePool(device, past), /TEXTURE_POOL_LAYERS/)
})

// Behaviour: a block pool counts one byte per texel and is never a render attachment — WebGPU
// refuses that usage on a compressed format, and no browser image is copied into it.
test('a block-compressed pool counts a quarter of the bytes and asks for no attachment usage', () => {
  const { device, textures: created } = fakeDevice()
  const pool = createWebgpuTilePool(device, {
    kind: 'color',
    lane: 'rgba',
    format: 'bc7-rgba-unorm-srgb',
    texelBytes: 1,
    layers: 1,
  })
  assert.equal(pool.bytes, poolLayerBytes(1))
  assert.equal(pool.tileBytes, tileBytes(1))
  assert.equal(pool.bytes * 4, poolLayerBytes(4))
  assert.equal(created[0].usage & GPUTextureUsage.RENDER_ATTACHMENT, 0)
  pool.acquire(1)
  assert.equal(pool.residentBytes, tileBytes(1))
})

test('take and return: the key follows the slot, and a full pool refuses without dropping', () => {
  const { device } = fakeDevice()
  const pool = createWebgpuTilePool(device, { ...rgba, layers: 1 })
  const first = pool.acquire(41)!
  assert.equal(pool.keyOf(first), 41)
  assert.deepEqual(pool.placeOf(first), { x: 0, y: 0, layer: 0 })
  assert.equal(pool.residentBytes, tileBytes(4))
  pool.release(first)
  assert.equal(pool.resident, 0)
  assert.equal(pool.freeAt(first), true)
  assert.throws(() => pool.keyOf(first), /TEXTURE_TILE_FREE/)
  for (let i = 0; i < TILES_PER_LAYER; i++) assert.notEqual(pool.acquire(i), undefined)
  assert.equal(pool.acquire(999), undefined, 'full: nothing to give, and nothing broken')
})

/** A queue as the readback brings it: its count, then its places. */
const queueOf = (places: number[]) => Uint32Array.from([places.length, ...places])

test('the victims are the places of the GPU queue in order; a place freed or taken again since its cut is skipped', () => {
  const { device } = fakeDevice()
  const pool = createWebgpuTilePool(device, { ...rgba, layers: 1 })
  assert.equal(pool.victim(), undefined, 'no queue yet: no victim, the arrival waits')
  const [a, b, c, d] = [1, 2, 3, 4].map((key) => pool.acquire(key)!)
  pool.follow(queueOf([c, a, b, d]), pool.arrivals)
  assert.equal(pool.victims(), 4)
  assert.equal(pool.rankOf(b), 2)
  assert.equal(pool.rankOf(99), undefined, 'unlisted: in use')
  assert.equal(pool.victim(), c)
  pool.release(c)
  // `a` leaves and its place is taken again after the cut: the queue no longer names its tile.
  pool.release(a)
  assert.equal(pool.acquire(5), a)
  pool.release(b)
  assert.equal(pool.victim(), d, '`a` arrived since, `b` is free: both skipped')
  pool.release(d)
  assert.equal(pool.victim(), undefined, 'the queue is spent')
})

test('random takes, returns and queues: a victim is always listed, held, and arrived before the cut', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const next = lcgRandom(seed)
    const { device } = fakeDevice()
    const pool = createWebgpuTilePool(device, { ...rgba, layers: 1 })
    let listed = new Set<number>(),
      cutAt = 0
    const arrivedAt = new Map<number, number>()
    for (let step = 0; step < 300; step++) {
      const roll = next(),
        held = pool.occupied()
      if (roll < 0.5) {
        const index = pool.acquire(step)
        if (index !== undefined) arrivedAt.set(index, pool.arrivals)
      } else if (roll < 0.7 && held.length) {
        pool.release(held[Math.floor(next() * held.length)])
      } else if (roll < 0.8) {
        const queue = held.filter(() => next() < 0.5)
        pool.follow(queueOf(queue), pool.arrivals)
        listed = new Set(queue)
        cutAt = pool.arrivals
      } else {
        const victim = pool.victim()
        if (victim === undefined) continue
        assert.ok(listed.has(victim), `seed ${seed}, step ${step}: listed`)
        assert.equal(pool.freeAt(victim), false, `seed ${seed}, step ${step}: held`)
        assert.ok(arrivedAt.get(victim)! <= cutAt, `seed ${seed}, step ${step}: before the cut`)
        pool.release(victim)
      }
    }
  }
})
