import test from 'node:test'
import assert from 'node:assert/strict'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { LIGHT } from '../../../../sdk-core/src/scene/light/store.fixture.ts'
import { createPreviousRanks } from './previousRanks.ts'

;(globalThis as { GPUBufferUsage?: object }).GPUBufferUsage ??= { STORAGE: 128, COPY_DST: 8 }

/** A device whose buffers hold their words, zero when made as on the GPU: `writes` counts the writes, `held` reads the last buffer made. */
function fakeDevice() {
  const writes: number[] = []
  let last = new Uint32Array(0)
  const device = {
    createBuffer: (d: { size: number }) => {
      last = new Uint32Array(d.size / 4)
      return { size: d.size, words: last }
    },
    queue: {
      writeBuffer: (
        b: { words: Uint32Array },
        at: number,
        w: Uint32Array,
        from = 0,
        count = w.length - from,
      ) => {
        b.words.set(w.subarray(from, from + count), at / 4)
        writes.push(count)
      },
    },
  }
  return { device: device as unknown as GPUDevice, writes, held: () => [...last] }
}

const entry = (local: number) => ({
  position: [0, 0, 0] as [number, number, number],
  radius: 1,
  color: [1, 1, 1] as [number, number, number],
  lightId: { localId: local, sourcePrimitiveId: 1 },
})

test('a view follows scene lights by name and simple lights by identity, across order and count', () => {
  const { device, held } = fakeDevice()
  const store = createSceneLightStore()
  store.add({ ...LIGHT, id: 'a' })
  store.add({ ...LIGHT, id: 'b' })
  store.setSimpleLights([entry(0), entry(1)])
  const ranks = createPreviousRanks(device)
  ranks.encode(store, 1)
  assert.deepEqual(held().slice(0, 4), [0, 0, 0, 0], 'no image before: no history')
  // A scene light is added first, and the simple lights swap.
  store.remove('a')
  store.setSimpleLights([entry(1), entry(0), entry(2)])
  ranks.encode(store, 2)
  // b was rank 1 and is rank 0; simple 1 was 3 and is 1, simple 0 was 2 and is 2, simple 2 is new.
  assert.deepEqual(held().slice(0, 4), [2, 4, 3, 0])
})

test('an image that does not follow the one before has no history, and a repeated image writes nothing', () => {
  const { device, writes, held } = fakeDevice()
  const store = createSceneLightStore()
  store.add({ ...LIGHT, id: 'a' })
  const ranks = createPreviousRanks(device)
  ranks.encode(store, 1)
  const count = writes.length
  ranks.encode(store, 1)
  assert.equal(writes.length, count)
  ranks.encode(store, 5)
  assert.equal(held()[0], 0)
  ranks.encode(store, 6)
  assert.equal(held()[0], 1)
})

test('an unchanged list does no work from one image to the next, and a changed one does', () => {
  const { device, writes, held } = fakeDevice()
  const store = createSceneLightStore()
  store.add({ ...LIGHT, id: 'a' })
  store.setSimpleLights([entry(0)])
  let reads = 0
  const identityOf = store.simple.identityOf
  store.simple.identityOf = (slot: number) => (reads++, identityOf(slot))
  const ranks = createPreviousRanks(device)
  ranks.encode(store, 1)
  ranks.encode(store, 2)
  assert.equal(held()[1], 2, 'the first image that follows writes the ranks')
  reads = 0
  const count = writes.length
  ranks.encode(store, 3)
  ranks.encode(store, 4)
  assert.equal(reads, 0)
  assert.equal(writes.length, count)
  store.setSimpleLights([entry(1), entry(0)])
  ranks.encode(store, 5)
  assert.ok(reads > 0)
  assert.deepEqual(held().slice(0, 3), [1, 0, 2])
  // The image after a change computes once more: its words are the identity, and stay so while the list does.
  ranks.encode(store, 6)
  assert.deepEqual(held().slice(0, 3), [1, 2, 3])
  const settledCount = writes.length
  reads = 0
  ranks.encode(store, 7)
  ranks.encode(store, 8)
  assert.equal(writes.length, settledCount)
  assert.equal(reads, 0, 'a settled list is not walked again')
})

test('ranks nobody reads are not computed and the next image that reads them has no history', () => {
  const { device, writes, held } = fakeDevice()
  const store = createSceneLightStore()
  store.add({ ...LIGHT, id: 'a' })
  const ranks = createPreviousRanks(device)
  ranks.encode(store, 1)
  ranks.encode(store, 2)
  assert.equal(held()[0], 1)
  assert.ok(ranks.encode(store, 3, false))
  const count = writes.length
  ranks.encode(store, 4, false)
  assert.equal(writes.length, count)
  ranks.encode(store, 5)
  assert.equal(held()[0], 0)
})

test('the words an unwanted view leaves are zeroed once, on the switch', () => {
  const { device, writes, held } = fakeDevice()
  const store = createSceneLightStore()
  store.add({ ...LIGHT, id: 'a' })
  const ranks = createPreviousRanks(device)
  ranks.encode(store, 1)
  ranks.encode(store, 2)
  assert.equal(held()[0], 1)
  ranks.encode(store, 3, false)
  assert.equal(held()[0], 0)
  const count = writes.length
  ranks.encode(store, 4, false)
  assert.equal(writes.length, count)
})
