// The placement tree's leaves the GPU writes (`treeLeavesWgsl.ts`, the shipped text run in
// JavaScript) are the CPU's formula to the word — the root node's box grown in its own space by the
// reach its mark carries, carried by the placement's double world, `boxTransform`'s order —, on a
// generated field posed by generated worlds: turns, uneven and negative scales, shears, far
// translations, marks with a reach and past every finite one, a parked placement.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { lcgRandom } from '../../../math/src/sequence/random.ts'
import { placementField } from '../gpu/dag/placementTree.fixture.ts'
import { packDagSelection } from '../gpu/dag/selection.ts'
import { frameWords, leafBoxes } from '../gpu/dag/treeRefitRun.fixture.ts'
import { REACH_UNBOUNDED } from '../gpu/dag/placementTree.ts'
import { treeLeavesWgsl } from './treeLeavesWgsl.ts'
import {
  DOUBLE_HELPERS,
  countLeadingZeros,
  generated,
  pair,
  type Pair,
} from './composeDoubles.fixture.ts'

test('every leaf the GPU writes is the CPU formula’s, word for word', () => {
  const next = lcgRandom(41),
    roots = placementField(9, 6)
  for (const [w, root] of roots.entries())
    root.world = { elements: generated(next, [10, 1e4, 1e6][w % 3]) }
  const dag = packDagSelection(roots)
  dag.mark[3] = 0x3c00 << 16
  dag.mark[4] = 0x4a00 << 16
  dag.mark[5] = REACH_UNBOUNDED << 16
  dag.rootNodes[6] = 0xffffffff
  const members: Pair[] = Array.from({ length: roots.length * 6 }, () => [0, 0])
  const run = shaderRun<{ writeLeaf(w: number, i: number): void }>(
    treeLeavesWgsl(),
    [
      ...DOUBLE_HELPERS,
      ...['dLess', 'dMin', 'dMax', 'fromF32', 'affineAxis', 'carriedBox', 'nodeWord', 'writeLeaf'],
    ],
    {
      countLeadingZeros,
      nodes: Array.from(new Uint32Array(dag.nodes.buffer, dag.nodes.byteOffset, dag.nodes.length)),
      worlds: roots.flatMap(({ world }) => Array.from(world.elements, (v) => pair(v))),
      frames: frameWords(dag),
      members,
    },
  )
  for (let w = 0; w < roots.length; w++) run.writeLeaf(w, w)
  const expected = leafBoxes(dag)
  for (let k = 0; k < expected.length; k++)
    assert.deepEqual(
      members[k],
      pair(expected[k]),
      `placement ${Math.floor(k / 6)}, bound ${k % 6}`,
    )
  assert.deepEqual(members.slice(36, 42), Array(6).fill([0, 0]), 'a parked placement writes none')
})
