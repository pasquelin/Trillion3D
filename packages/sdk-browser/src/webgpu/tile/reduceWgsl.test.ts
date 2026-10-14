// The gather of the tile feedback (`GATHER_WGSL`) runs in rows (`dispatchRows`, `reduce.ts`): its
// list's cap grows with the image's pixels, past the workgroups one row holds. A thread reads its
// flat rank (`flatIndex`): one of the second row gathers the entry after the first row's last, never
// one the first row gathered.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import { GATHER_WGSL } from './reduceWgsl.ts'

test('a thread of the gather’s second row gathers the entry its flat rank names', () => {
  const cap = 4 * WORKGROUP_THREADS,
    // Two workgroups a row, two rows: thread 5 of the second row is entry 2 · 64 + 5.
    n = [2, 2, 1],
    entry = 2 * WORKGROUP_THREADS + 5,
    rank = 7
  const hits = new Array<number>(1 + 2 * cap).fill(0),
    tileFeedback = new Array<number>(16).fill(0)
  hits[0] = cap
  hits[1 + entry] = rank
  tileFeedback[rank] = 42
  const { gather } = shaderRun<{ gather: (id: number[], n: number[]) => void }>(
    GATHER_WGSL,
    ['gather', 'flatIndex'],
    { hits, tileFeedback, uni: { cap } },
  )
  gather([5, 1, 0], n)
  assert.equal(hits[1 + cap + entry], 42, 'its count into the weights')
  assert.equal(tileFeedback[rank], 0, 'its counter zeroed for the next image')
  assert.equal(hits[1 + cap + 5], 0, 'the first row’s entry left to its own thread')
})
