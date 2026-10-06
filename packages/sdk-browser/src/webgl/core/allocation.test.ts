// #840: reading a refused allocation never holds the main thread. `getError` waits for the GPU
// process to run every command sent before it: read after each upload, it held the frame that
// streamed pages in for the whole upload (a 100–140 ms hitch on sponza `rue`).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  allocated,
  fenceAllocations,
  refusedNow,
  settleAllocations,
  takeOutOfMemory,
} from './allocation.ts'

const OUT_OF_MEMORY = 0x0505,
  SIGNALED = 0x9119,
  UNSIGNALED = 0x9118

/** A context counting its error reads, whose fence the test passes by hand. */
function context() {
  const seen = { reads: 0, fences: 0, deleted: 0, passed: false, refuse: false }
  const gl = {
    NO_ERROR: 0,
    OUT_OF_MEMORY,
    CONTEXT_LOST_WEBGL: 0x9242,
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    SIGNALED,
    getError: () => (seen.reads++, seen.refuse ? ((seen.refuse = false), OUT_OF_MEMORY) : 0),
    fenceSync: () => (seen.fences++, {}),
    getSyncParameter: () => (seen.passed ? SIGNALED : UNSIGNALED),
    deleteSync: () => seen.deleted++,
  } as unknown as WebGL2RenderingContext
  return { gl, seen }
}

test('an allocation reads no error: they are read before a frame, once the GPU ran past them', () => {
  const { gl, seen } = context()
  let redone = 0
  seen.refuse = true
  allocated(gl, 'geometry', () => redone++)
  allocated(gl, 'geometry', () => redone++)
  assert.equal(seen.reads, 0, 'the allocations read nothing')
  fenceAllocations(gl)
  settleAllocations(gl)
  assert.equal(seen.reads, 0, 'a fence not passed is never waited on')
  assert.equal(takeOutOfMemory(gl, 'geometry'), false)
  allocated(gl, 'geometry', () => redone++) // sent after the fence, in the next frame
  seen.passed = true
  settleAllocations(gl)
  assert.ok(seen.reads > 0, 'the fence passed: the errors are read')
  assert.equal(redone, 3, 'a refusal redoes every allocation not yet confirmed')
  assert.equal(takeOutOfMemory(gl, 'geometry'), true, 'the context is marked')
  assert.equal(takeOutOfMemory(gl, 'geometry'), false, 'once')
  const reads = seen.reads
  settleAllocations(gl)
  fenceAllocations(gl)
  assert.equal(seen.reads, reads, 'nothing left to read')
  assert.equal(seen.fences, 1, 'nothing left to fence')
})

test('allocations the GPU accepted are confirmed and never redone', () => {
  const { gl, seen } = context()
  let redone = 0
  allocated(gl, 'geometry', () => redone++)
  fenceAllocations(gl)
  seen.passed = true
  settleAllocations(gl)
  assert.equal(redone, 0)
  assert.equal(takeOutOfMemory(gl, 'geometry'), false)
})

test('a refusal read at once (a one-time build) redoes the allocations it read for, once', () => {
  const { gl, seen } = context()
  let redone = 0
  allocated(gl, 'geometry', () => redone++)
  fenceAllocations(gl)
  allocated(gl, 'geometry', () => redone++)
  seen.refuse = true
  assert.equal(refusedNow(gl), true)
  assert.equal(redone, 2, 'the flag it consumed was theirs: both are redone now')
  seen.passed = true
  settleAllocations(gl)
  assert.equal(redone, 2, 'never twice')
  assert.equal(takeOutOfMemory(gl, 'geometry'), true)
})

test('a GPU frames behind: the oldest fence is kept until passed, each frame fences its own', () => {
  const { gl, seen } = context()
  const pending = new Set<WebGLSync>(),
    order: WebGLSync[] = []
  Object.assign(gl, {
    fenceSync: () => {
      const fence = {}
      pending.add(fence)
      order.push(fence)
      return fence
    },
    getSyncParameter: (fence: WebGLSync) => (pending.has(fence) ? UNSIGNALED : SIGNALED),
  })
  let redone = 0
  for (let frame = 0; frame < 3; frame++) {
    settleAllocations(gl)
    allocated(gl, 'texture', () => redone++)
    fenceAllocations(gl)
  }
  assert.deepEqual([order.length, seen.deleted, seen.reads], [3, 0, 0], 'no fence replaced')
  pending.delete(order[0]) // the GPU caught up with the first frame only
  settleAllocations(gl)
  assert.deepEqual([seen.reads > 0, seen.deleted], [true, 1], 'the oldest batch confirmed')
  seen.refuse = true
  pending.clear()
  settleAllocations(gl)
  assert.equal(redone, 2, 'the two batches left are redone')
  assert.equal(takeOutOfMemory(gl, 'geometry'), false, 'a texture refusal is no geometry one')
  assert.equal(takeOutOfMemory(gl, 'texture'), true, 'the pool of the refused batches is marked')
})
