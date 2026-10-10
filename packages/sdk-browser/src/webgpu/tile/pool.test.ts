import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuTilePool } from './pool.ts'
import { poolLayerBytes, POOL_MAX_LAYERS, tileBytes, TILES_PER_LAYER } from '../../texture/tiles.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'

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
  pool.acquire(1, 0)
  assert.equal(pool.residentBytes, tileBytes(1))
})

test('take, touch, return: the key follows the slot, and a full pool refuses without dropping', () => {
  const { device } = fakeDevice()
  const pool = createWebgpuTilePool(device, { ...rgba, layers: 1 })
  const first = pool.acquire(41, 3)!
  assert.equal(pool.keyOf(first), 41)
  assert.deepEqual(pool.placeOf(first), { x: 0, y: 0, layer: 0 })
  assert.equal(pool.residentBytes, tileBytes(4))
  pool.touch(first, 9)
  assert.equal(pool.lastUseOf(first), 9)
  pool.release(first)
  assert.equal(pool.resident, 0)
  assert.throws(() => pool.keyOf(first), /TEXTURE_TILE_FREE/)
  for (let i = 0; i < TILES_PER_LAYER; i++) assert.notEqual(pool.acquire(i, 1), undefined)
  assert.equal(pool.acquire(999, 1), undefined, 'full: nothing to give, and nothing broken')
})

test('eviction candidates are unpinned tiles that neither this image nor the previous one has seen, oldest first', () => {
  const { device } = fakeDevice()
  const pool = createWebgpuTilePool(device, { ...rgba, layers: 1 })
  const tail = pool.acquire(1, 1, true)!
  const older = pool.acquire(3, 1)!
  const old = pool.acquire(2, 2)!
  const fresh = pool.acquire(4, 7)!
  const drain = (frame: number) => {
    const out: number[] = []
    for (let index = pool.victim(frame); index !== undefined; index = pool.victim(frame)) {
      out.push(index)
      pool.release(index)
    }
    return out
  }
  assert.equal(pool.victim(2), undefined, 'seen on the previous image: kept')
  assert.equal(pool.victim(3), older)
  assert.deepEqual(drain(8), [older, old], 'the tile seen on the previous image is kept')
  assert.deepEqual(drain(9), [fresh])
  assert.equal(pool.victim(100), undefined, 'a pinned tile never leaves')
  assert.equal(pool.resident, 1)
  assert.equal(pool.pinnedOf(tail), true)
})

test('random acquires, touches and releases: the victims leave by last use, then by touch', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const next = random(seed)
    const { device } = fakeDevice()
    const pool = createWebgpuTilePool(device, { ...rgba, layers: 1 })
    /** The model: each resident place's last use and the order it was last touched in. */
    const model = new Map<number, { use: number; at: number; pinned: boolean }>()
    let at = 0,
      frame = 0
    for (let step = 0; step < 300; step++) {
      frame += next() < 0.3 ? 1 : 0
      const roll = next(),
        places = [...model.keys()]
      if (roll < 0.5) {
        const pin = next() < 0.1,
          index = pool.acquire(step, frame, pin)
        if (index !== undefined) model.set(index, { use: frame, at: at++, pinned: pin })
      } else if (roll < 0.8 && places.length) {
        const index = places[Math.floor(next() * places.length)]
        pool.touch(index, frame)
        const each = model.get(index)!
        if (each.use !== frame) Object.assign(each, { use: frame, at: at++ })
      } else if (places.length) {
        const index = places[Math.floor(next() * places.length)]
        pool.release(index)
        model.delete(index)
      }
      const eligible = [...model]
        .filter(([, each]) => !each.pinned && each.use < frame - 1)
        .sort(([, a], [, b]) => a.use - b.use || a.at - b.at)
      assert.equal(pool.victim(frame), eligible[0]?.[0], `seed ${seed}, step ${step}`)
    }
  }
})
