import assert from 'node:assert/strict'
import test from 'node:test'
import { createUniformPool, perViewRuns } from './encoderUniforms.ts'
import { commitSubmitted, destroyRetired, dropSubmitted, openEncoder } from './frameRetire.ts'

const shared = {} as GPUDevice
/** An encoder made and open, as an image part is (a pool refuses a raw one). */
const encoder = (on = shared) => openEncoder(on, () => ({}) as GPUCommandEncoder)
const fakeDevice = () => {
  const made: { destroyed: boolean; destroy(): void }[] = []
  const device = {
    createBuffer: () => {
      const buffer = {
        destroyed: false,
        destroy() {
          buffer.destroyed = true
        },
      }
      made.push(buffer)
      return buffer
    },
  } as unknown as GPUDevice
  return { device, made }
}
;(globalThis as { GPUBufferUsage?: unknown }).GPUBufferUsage ??= { UNIFORM: 64, COPY_DST: 8 }

test('a run of an encode gets its own buffer, the next encode reuses them', () => {
  const { device, made } = fakeDevice()
  const pool = createUniformPool('u', 16)
  const a = encoder()
  const first = [pool.next(device, a), pool.next(device, a)]
  assert.deepEqual(
    first.map((run) => run.index),
    [0, 1],
  )
  assert.notEqual(first[0]!.buffer, first[1]!.buffer)
  // Submitted: its buffers are free for the next encoder.
  commitSubmitted(a)
  const again = pool.next(device, encoder())
  assert.equal(again.index, 0)
  assert.equal(again.buffer, first[0]!.buffer)
  assert.equal(made.length, 2)
})

test('an encoder dropped unsubmitted gives its buffers back', () => {
  const { device, made } = fakeDevice()
  const pool = createUniformPool('u', 16)
  const a = encoder()
  pool.next(device, a)
  dropSubmitted(a)
  assert.equal(pool.next(device, encoder()).index, 0)
  assert.equal(made.length, 1)
})

test('two encoders of a view open before either submits never share a buffer', () => {
  const { device } = fakeDevice()
  const pool = createUniformPool('u', 16)
  const a = encoder()
  const b = encoder()
  const runs = [
    pool.next(device, a),
    pool.next(device, b),
    pool.next(device, a),
    pool.next(device, b),
  ]
  assert.equal(new Set(runs.map((run) => run.buffer)).size, 4)
  commitSubmitted(a)
  // a's buffers (0 and 2) are free again, b's stay taken.
  const c = encoder()
  assert.deepEqual([pool.next(device, c).index, pool.next(device, c).index], [0, 2])
})

test('perViewRuns keeps one pool and one group cache a view, made once', () => {
  const { device } = fakeDevice()
  const runs = perViewRuns('u', 16)
  const one = {}
  const two = {}
  assert.equal(runs.of(one, device), runs.of(one, device))
  assert.notEqual(runs.of(one, device).uniforms, runs.of(two, device).uniforms)
  assert.notEqual(runs.of(one, device).groups, runs.of(two, device).groups)
  const kept = runs.of(one, device)
  runs.release(one)
  assert.notEqual(runs.of(one, device), kept)
})

test('two pools never share a buffer, so interleaved encoders of two views do not overwrite each other', () => {
  const { device } = fakeDevice()
  const one = createUniformPool('u', 16)
  const two = createUniformPool('u', 16)
  assert.notEqual(one.next(device, encoder()).buffer, two.next(device, encoder()).buffer)
})

test('a view asked on another device destroys at once what it held and starts over', () => {
  const first = fakeDevice()
  const second = fakeDevice()
  const runs = perViewRuns('u', 16)
  const view = {}
  const at = encoder()
  runs.of(view, first.device).uniforms.next(first.device, at)
  const moved = runs.of(view, second.device).uniforms.next(second.device, at)
  assert.equal(moved.index, 0)
  assert.equal(second.made.length, 1)
  // The first device was replaced: it runs nothing more, so nothing waits for its frame end.
  assert.equal(first.made[0]!.destroyed, true)
})

test('the ranks of encoders open at once never collide and are free again once settled', () => {
  const { device } = fakeDevice()
  const pool = createUniformPool('u', 16)
  const a = encoder()
  const b = encoder()
  const ranks = [pool.next(device, a), pool.next(device, b), pool.next(device, a)].map(
    (r) => r.index,
  )
  assert.deepEqual(ranks, [0, 1, 2])
  dropSubmitted(a)
  assert.deepEqual([pool.next(device, encoder()).index], [0])
})

test('an encoder open across a release settles without freeing the ranks of the new owner', () => {
  const { device } = fakeDevice()
  const pool = createUniformPool('u', 16)
  const old = encoder()
  pool.next(device, old)
  pool.release(device)
  const fresh = encoder()
  assert.equal(pool.next(device, fresh).index, 0)
  // The old encoder settles late: the rank the new owner holds stays taken.
  dropSubmitted(old)
  assert.equal(pool.next(device, encoder()).index, 1)
})

test('a release with an encoder open retires the buffers when that encoder settles, not at another encoder’s submit', () => {
  const { device, made } = fakeDevice()
  const pool = createUniformPool('u', 16)
  const open = encoder(device)
  pool.next(device, open)
  pool.release(device)
  // Another encoder is submitted: it names nothing the open one bound, and the buffers stay.
  destroyRetired(device, encoder())
  assert.equal(made[0]!.destroyed, false)
  commitSubmitted(open)
  destroyRetired(device)
  assert.equal(made[0]!.destroyed, true)
})

test('a release with no encoder open retires the buffers at once', () => {
  const { device, made } = fakeDevice()
  const pool = createUniformPool('u', 16)
  const done = encoder()
  pool.next(device, done)
  commitSubmitted(done)
  pool.release(device)
  destroyRetired(device)
  assert.equal(made[0]!.destroyed, true)
})

test('an encoder not made by an image part is refused: it would never settle and free its ranks', () => {
  const { device } = fakeDevice()
  const pool = createUniformPool('u', 16)
  assert.throws(() => pool.next(device, {} as GPUCommandEncoder), /GPU_UNIFORMS_RAW_ENCODER/)
})

test('a run on an encoder already settled holds its rank no longer than the run: the rank is free for the next encoder', () => {
  const { device } = fakeDevice()
  const pool = createUniformPool('u', 16)
  const settled = encoder()
  dropSubmitted(settled)
  const run = pool.next(device, settled)
  assert.equal(run.index, 0)
  assert.equal(pool.next(device, encoder()).index, 0)
})
