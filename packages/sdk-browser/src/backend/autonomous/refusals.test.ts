// #840: the autonomous WebGL2 frame answers each pool its context refused. Geometry draws a level
// coarser; a map or a frame target, with nothing coarser to show, is published and drawn again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRefusalAnswer } from './refusals.ts'
import { allocated, refusedNow } from '../../webgl/core/allocation.ts'
import type { BackendDiagnostic } from '../types.ts'
import type { RefusedPool } from '../../residency/outOfMemory.ts'

/** A context whose next error read is `OUT_OF_MEMORY`, and the frame answering its refusals. */
function frame() {
  let refuse = false
  const gl = {
    OUT_OF_MEMORY: 0x0505,
    CONTEXT_LOST_WEBGL: 0x9242,
    getError: () => (refuse ? ((refuse = false), 0x0505) : 0),
    deleteSync() {},
  } as unknown as WebGL2RenderingContext
  const seen = { halved: 0, redrawn: 0, diagnostics: [] as BackendDiagnostic[] }
  const answer = createRefusalAnswer({
    gl: () => gl,
    pool: { outOfMemory: () => (seen.halved++, true) },
    onDiagnostic: (diagnostic) => seen.diagnostics.push(diagnostic),
    redraw: () => seen.redrawn++,
  })
  /** `pool` allocated, refused and read, then the next frame's answer. */
  const refused = (pool: RefusedPool, redo: () => void) => {
    allocated(gl, pool, redo)
    refuse = true
    assert.equal(refusedNow(gl), true)
    answer()
  }
  return { answer, refused, seen }
}

test('a refused map is sent again at its next bind and published, the geometry kept', () => {
  const { answer, refused, seen } = frame()
  let sentAgain = 0
  refused('texture', () => sentAgain++)
  assert.equal(sentAgain, 1, 'the map is marked to be sent again')
  assert.equal(seen.halved, 0, 'no coarser geometry for a map')
  assert.equal(seen.redrawn, 1, 'the image drawn without it is drawn again')
  assert.deepEqual(
    seen.diagnostics.map(({ phase, context }) => [phase, context?.pool, context?.grantedBytes]),
    [['gpu-out-of-memory', 'texture', null]],
  )
  answer()
  assert.deepEqual([seen.redrawn, seen.diagnostics.length], [1, 1], 'answered once')
})

test('a refused frame target is published; a refused geometry halves its pool', () => {
  const { refused, seen } = frame()
  refused('target', () => {})
  assert.deepEqual(
    [seen.halved, seen.diagnostics.map(({ context }) => context?.pool)],
    [0, ['target']],
  )
  refused('geometry', () => {})
  assert.deepEqual([seen.halved, seen.redrawn], [1, 2])
})
