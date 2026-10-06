// The ring the shadow maps' late readbacks share (`readbackRing.ts`): a buffer a frame, none while
// all are in flight, read in place once mapped, and a copy never submitted taken over.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { createVsmReadbackRing } from './readbackRing.ts'

const settled = () => new Promise((resolve) => setImmediate(resolve))

test('a buffer maps after its submit, is read in place and returns to the ring', async () => {
  const { device, buffers } = fakeDevice()
  const seen: ArrayBuffer[] = []
  const ring = createVsmReadbackRing(device, { label: 'r', bytes: 16, count: 2 }, (m) =>
    seen.push(m),
  )
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
  const ring = createVsmReadbackRing(
    device,
    { label: 'r', bytes: 4, count: 2, eager: true },
    () => {},
  )
  assert.equal(buffers.length, 2, 'eager: made at once')
  const first = ring.take()
  assert.equal(ring.take(), first)
  ring.destroy()
})

test('a read that throws still returns its buffer to the ring', () => {
  const { device, buffers } = fakeDevice()
  let reads = 0
  const ring = createVsmReadbackRing(device, { label: 'r', bytes: 4, count: 1 }, () => {
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
