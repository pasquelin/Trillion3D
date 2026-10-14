// The rows the CPU names to the rows pass (`rowTargets.ts`): a row named twice takes one entry, its
// bits joined; while every row is derived the staled rows alone are kept; and a command buffer
// holding the pass that is dropped names its staled rows again — the old code staled every page.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import { nameCastRow, deriveRootRows } from './rowWords.ts'
import { deriveEveryRow, rowWordsDropped, target, targetsTaken } from './rowTargets.ts'
import { ROW_EMITS, ROW_NAMED, ROW_STALES } from './rowWordsWgsl.ts'

/** A runtime whose rows pass derives the rows named alone. */
function session() {
  const rt = {} as Pick<WebgpuPagesRuntime, 'rowWords'>
  deriveRootRows(rt, 0)
  rt.rowWords!.all = false
  rt.rowWords!.roots.length = 0
  return rt.rowWords!
}

const listed = (state: ReturnType<typeof session>) =>
  [...state.targets.subarray(0, state.count)].map((word) => [
    word & ROW_NAMED,
    (word & ROW_EMITS) !== 0,
    (word & ROW_STALES) !== 0,
  ])

test('a row named twice is listed once, its bits joined and counted once', () => {
  const state = session(),
    rt = { rowWords: state }
  nameCastRow(rt, 4)
  nameCastRow(rt, 4)
  target(state, 4, ROW_EMITS)
  target(state, 7)
  assert.deepEqual(listed(state), [
    [4, true, true],
    [7, false, false],
  ])
  assert.deepEqual([state.emits, state.stales], [1, 1])
})

test('every row derived keeps the staled rows alone, and still lists a row staled then', () => {
  const state = session()
  target(state, 1, ROW_EMITS)
  nameCastRow({ rowWords: state }, 2)
  deriveEveryRow(state)
  assert.deepEqual(listed(state), [[2, false, true]])
  target(state, 3, ROW_EMITS)
  nameCastRow({ rowWords: state }, 5)
  assert.deepEqual(listed(state), [
    [2, false, true],
    [5, false, true],
  ])
  assert.deepEqual([state.emits, state.stales], [0, 2])
})

test('a dropped command buffer that held the pass names its staled rows again, every row derived', () => {
  const state = session(),
    held = {} as GPUCommandEncoder
  nameCastRow({ rowWords: state }, 6)
  target(state, 8)
  targetsTaken(state, held)
  assert.deepEqual([state.count, state.stales, state.all], [0, 0, false])
  rowWordsDropped(state, {} as GPUCommandEncoder)
  assert.deepEqual([state.count, state.all], [0, false], 'another buffer dropped: nothing')
  rowWordsDropped(state, held)
  assert.equal(state.all, true)
  assert.deepEqual(listed(state), [[6, false, true]], 'staled again from the spheres it held')
  rowWordsDropped(state, held)
  assert.equal(state.count, 1, 'once')
})
