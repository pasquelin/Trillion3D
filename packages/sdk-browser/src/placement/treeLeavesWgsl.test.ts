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
import { packDagSelection } from '../gpu/dag/pack.ts'
import { frameTableOf, leafBoxes } from '../gpu/dag/treeRefitRun.fixture.ts'
import { REACH_UNBOUNDED } from '../gpu/dag/placementTree.ts'
import { TREE_LEAVES_WGSL } from './treeLeavesWgsl.ts'
import { recordTable } from '../gpu/core/recordTexture.fixture.ts'
import { NODE_TABLE } from '../gpu/dag/nodeTable.ts'
import { DAG_NODE_FLOATS } from '../gpu/dag/types.ts'
import { DOUBLE_HELPERS, generated, pair, type Pair } from './composeDoubles.fixture.ts'

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
  // The cut's nodes as their record table holds them (`nodeTable.ts`).
  const count = dag.nodes.length / DAG_NODE_FLOATS,
    nodes = recordTable(NODE_TABLE, count),
    words = new Uint32Array(dag.nodes.buffer, dag.nodes.byteOffset, dag.nodes.length)
  for (let n = 0; n < count; n++)
    nodes.set('Node', n, words.subarray(n * DAG_NODE_FLOATS, (n + 1) * DAG_NODE_FLOATS))
  const run = shaderRun<{ writeLeaf(w: number): void }>(
    TREE_LEAVES_WGSL,
    [
      ...DOUBLE_HELPERS,
      ...['dLess', 'dMin', 'dMax', 'fromF32', 'affineAxis', 'carriedBox', 'nodesNode', 'nodesWord'],
      ...['framesRow', 'framesWord', 'writeLeaf'],
    ],
    {
      nodes,
      worlds: roots.flatMap(({ world }) => Array.from(world.elements, (v) => pair(v))),
      frames: frameTableOf(dag),
      members,
    },
  )
  for (let w = 0; w < roots.length; w++) run.writeLeaf(w)
  const expected = leafBoxes(dag)
  for (let k = 0; k < expected.length; k++)
    assert.deepEqual(
      members[k],
      pair(expected[k]),
      `placement ${Math.floor(k / 6)}, bound ${k % 6}`,
    )
  assert.deepEqual(members.slice(36, 42), Array(6).fill([0, 0]), 'a parked placement writes none')
})
