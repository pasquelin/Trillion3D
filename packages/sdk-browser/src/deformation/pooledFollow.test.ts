// A growth of the float pool moves the deformation block after the wider vertices (`pooledRows.ts`,
// `SessionDeformation.place`): the placements' records, which name a record and a block, are laid
// out again, and every transparent span that reads a block is pointed at the new place; a span with
// no results is left as it is.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deformOutputWord, followPooledBlocks } from './outputs.ts'
import { createChangedRuns } from '../geometry/residency/ranges.ts'
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts'

/** Four pages — a float-pool block, a page's own results, the block again, a page with none —, a
 *  placement each, three transparent spans. */
function rig() {
  const block = { from: 100, count: 9, pool: { attributes: {} as Geometry['attributes'] } },
    own = { from: 12, count: 3 }
  const outputs = [block, own, block, undefined]
  const laid: number[] = []
  const spans = new Uint32Array(12),
    dirtySpans = createChangedRuns()
  spans.set([5, 6, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0]) // entry 0 drawn, entry 2 holds no corner
  const rt = {
    layout: {
      selectionRoots: outputs.map(() => ({})),
      clusters: { placementInfo: { layOut: (placements: number) => laid.push(placements) } },
      deformationOutputOf: (page: number) => outputs[page],
    },
    blendState: { table: { pageOfEntry: Int32Array.from([0, 1, 2]), spans }, dirtySpans },
  } as unknown as Parameters<typeof followPooledBlocks>[0]
  return { block, own, laid, spans, dirtySpans, rt }
}

test('the placements and spans of a moved float-pool block follow it; a tail stays', () => {
  const { block, laid, spans, dirtySpans, rt } = rig()
  block.from = 4000
  followPooledBlocks(rt)
  const moved = deformOutputWord(block)
  assert.deepEqual(laid, [4], 'every placement’s record laid out again with its results')
  assert.deepEqual([spans[2], spans[10], [...dirtySpans.take()]], [moved, 0, [0]])
})
