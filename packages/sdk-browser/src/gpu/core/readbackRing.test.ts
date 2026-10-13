// The ring the late readbacks share (`readbackRing.ts`): a buffer a frame, none while
// all are in flight, read in place once mapped, and a copy never submitted taken over.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { createReadbackRing, ReadbackRefused } from './readbackRing.ts'

const settled = () => new Promise((resolve) => setImmediate(resolve))

test('a buffer maps after its submit, is read in place and returns to the ring', async () => {
  const { device, buffers } = fakeDevice()
  const seen: ArrayBuffer[] = []
  const ring = createReadbackRing(device, { label: 'r', bytes: 16, count: 2 }, (m) => seen.push(m))
  const a = ring.take()!
  ring.submitted()
  const b = ring.take()!
  ring.submitted()
  assert.notEqual(a, b)
  assert.equal(ring.take(), undefined, 'both in flight: nothing this frame')
  await settled()
  assert.equal(seen.length, 2)
  assert.equal(seen[0], (a as unknown as { getMappedRange(): ArrayBuffer }).getMappedRange())
  assert.ok(ring.take(), 'a mapped buffer is free again')
  assert.equal(buffers.length, 2, 'two buffers made in all')
})

test('a copy whose frame was never submitted is taken over, not leaked', () => {
  const { device, buffers } = fakeDevice()
  const ring = createReadbackRing(device, { label: 'r', bytes: 4, count: 2, eager: true }, () => {})
  assert.equal(buffers.length, 2, 'eager: made at once')
  const first = ring.take()
  assert.equal(ring.take(), first)
  ring.destroy()
})

test('a read that throws still returns its buffer to the ring', () => {
  const { device, buffers } = fakeDevice()
  let reads = 0
  const ring = createReadbackRing(device, { label: 'r', bytes: 4, count: 1 }, () => {
    reads++
    throw new Error('read failed')
  })
  const thrown: unknown[] = []
  for (let k = 0; k < 3; k++) {
    const buffer = ring.take()
    assert.ok(buffer, `frame ${k}: the single buffer is free again`)
    // Settle the mapping synchronously and keep the callback's exception for the assertion.
    ;(buffer as unknown as { mapAsync(): unknown }).mapAsync = () => ({
      then(ok: () => void) {
        try {
          ok()
        } catch (error) {
          thrown.push(error)
        }
      },
    })
    ring.submitted()
  }
  assert.equal(reads, 3)
  assert.equal(thrown.length, 3)
  assert.equal(buffers.length, 1)
})

test('a take that asks more than a free buffer holds makes it again at its size', async () => {
  const { device, buffers, destroyed } = fakeDevice()
  const ring = createReadbackRing(
    device,
    { label: 'r', bytes: 16, count: 1, eager: true },
    () => {},
  )
  const small = ring.take()!
  ring.submitted()
  await settled()
  const large = ring.take(0, 64)!
  assert.notEqual(large, small)
  assert.equal(large.size, 64)
  assert.ok(destroyed.includes(small), 'the outgrown buffer is destroyed')
  assert.equal(ring.bytes, 64, 'the ring holds the large one alone')
  ring.dropped()
  assert.equal(ring.take(0, 32), large, 'a buffer large enough is kept')
  assert.equal(buffers.length, 2)
})

test('a chained ring maps each copy in its caller’s chain, in order; a refusal by name', async () => {
  const { device } = fakeDevice()
  const seen: number[] = []
  let chain: Promise<unknown> = Promise.resolve()
  const errors: unknown[] = []
  const ring = createReadbackRing<number>(
    device,
    {
      label: 'r',
      bytes: 8,
      count: 2,
      chain: (read) => void (chain = chain.then(read).catch((error) => errors.push(error))),
    },
    (_mapped, _staging, tag) => seen.push(tag),
  )
  const a = ring.take(1)!,
    b = ring.take(2)!
  assert.notEqual(a, b, 'two copies in flight never share a buffer')
  assert.equal(ring.take(3), undefined)
  assert.equal(ring.held(), 2)
  ring.submitted(b)
  ring.dropped(a)
  assert.equal(ring.held(), 1, 'the dropped copy is free again, never read')
  const c = ring.take(3)!
  ;(c as unknown as { mapAsync(): Promise<void> }).mapAsync = () =>
    Promise.reject(new Error('lost'))
  ring.submitted(c)
  await chain
  await settled()
  assert.deepEqual(seen, [2], 'read in the order submitted, the refused one read never')
  assert.ok(errors[0] instanceof ReadbackRefused)
  assert.equal(ring.held(), 0, 'every buffer back')
})
