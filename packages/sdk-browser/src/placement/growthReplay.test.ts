// A cut packed beside the running one is handed, at its swap, the poses named since its pack —
// those alone —, or every world when the host walked them meanwhile, the roots it packed beyond
// the running cut's compared as it holds them; a growth in place leaves the running cut its own.
// On generated moves of 1 to 500 placements among 10⁴.
import test from 'node:test'
import assert from 'node:assert/strict'
import { keepMovesFor, replayMoves } from './growthAnnounce.ts'
import { noteWorldMoved, type MovedWorlds } from '../webgpu/pages/render/movedWorlds.ts'
import { createSortedKeys, takeSorted } from '../webgpu/cut/denseKeys.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'

const runtime = () => {
  const movedWorlds: MovedWorlds = createSortedKeys()
  const rt = {
    run: { movedWorlds, gate: { engineMovedInPlace() {} } },
    layout: { worldUpdates: new Float32Array(10_000 * 16) },
  } as unknown as WebgpuPagesRuntime
  const cut = { sent: [] as (number[] | 'all')[] }
  const target = {
    updateWorlds: (_: Float32Array, named?: Int32Array) => (
      cut.sent.push(named ? [...named] : 'all'),
      named ?? new Int32Array(0)
    ),
  }
  return { rt, cut, target }
}

test('the poses named while a cut was made reach it at its swap, they alone', () => {
  for (const count of [1, 37, 500]) {
    const { rt, cut, target } = runtime()
    keepMovesFor(rt)
    const ranks = Array.from({ length: count }, (_, k) => (k * 7919) % 10_000)
    for (const rank of ranks) noteWorldMoved(rt.run, rank)
    // The running cut's upload takes them meanwhile: the new one must still be told.
    takeSorted(rt.run.movedWorlds)
    replayMoves(rt, target, [], 0)
    const sorted = [...ranks].sort((a, b) => a - b)
    assert.deepEqual(cut.sent, [sorted], `${count} poses`)
    assert.equal(rt.run.movedWorlds.since, undefined, 'kept no more')
  }
})

test('a host walk meanwhile hands the new cut every world', () => {
  const { rt, cut, target } = runtime()
  keepMovesFor(rt)
  noteWorldMoved(rt.run, 3)
  rt.run.movedWorlds.since!.walked = true
  replayMoves(rt, target, [], 0)
  assert.deepEqual(cut.sent, ['all'])
})

test('a host walk meanwhile compares the roots the cut packed as it holds them, never as zeros', () => {
  const { rt, target } = runtime()
  const sent: Float32Array[] = []
  target.updateWorlds = (worlds: Float32Array) => (sent.push(worlds.slice()), new Int32Array(0))
  keepMovesFor(rt)
  rt.run.movedWorlds.since!.walked = true
  const added = [5, 6].map((x) => ({
    world: { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]) },
  }))
  replayMoves(rt, target, added, 9998)
  assert.deepEqual([sent[0][9998 * 16 + 12], sent[0][9999 * 16 + 12]], [5, 6], 'their worlds')
})
