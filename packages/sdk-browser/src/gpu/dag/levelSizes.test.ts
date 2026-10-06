// Upper bound on which each descent pass dispatches flat. It is what replaces arming the
// dispatch argument and the cut it imposes (measurement: `hierarchy.ts`), and it is
// therefore what must be safe: a queue longer than its stage would leave kept nodes with no
// pass to read them, and the cut would lose geometry without anything saying so.
import test from 'node:test'
import assert from 'node:assert/strict'
import { flatHierarchy, hierarchyLevelSizes } from './hierarchy.ts'
import { DAG_NODE_FLOATS } from './types.ts'
import { dagFixture } from '../../page/selection/dag.fixture.ts'
import { packed } from './selectionHelpers.fixture.ts'

/** Stage of each packed DAG node, read as the descent reads it: roots at stage zero. */
function etages(dag: ReturnType<typeof packed>['dag']) {
  const ints = new Uint32Array(dag.nodes.buffer)
  const etage = new Int32Array(Math.max(1, dag.nodeCount)).fill(-1)
  let frontier: number[] = []
  for (const root of dag.rootNodes) if (root !== 0xffffffff) frontier.push(root)
  for (let level = 0; frontier.length; level++) {
    const suivante: number[] = []
    for (const node of frontier) {
      assert.equal(etage[node], -1, 'a node belongs to only one stage')
      etage[node] = level
      const base = node * DAG_NODE_FLOATS
      for (let c = 0; c < ints[base + 15]; c++) suivante.push(ints[base + 3] + c)
    }
    frontier = suivante
  }
  return etage
}

test("a stage's count bounds its pass's queue, and the sum covers every node", () => {
  const { dag } = packed(dagFixture())
  const etage = etages(dag)
  const count = new Int32Array(dag.levelSizes.length)
  let atteints = 0
  for (const level of etage)
    if (level >= 0) {
      count[level]++
      atteints++
    }
  assert.deepEqual(Array.from(dag.levelSizes), Array.from(count))
  // A node no root reaches is never read: the sum of stages is therefore what the descent can
  // see, and nothing more.
  assert.equal(
    Array.from(dag.levelSizes).reduce((a, b) => a + b, 0),
    atteints,
  )
  assert.ok(atteints > 0)
})

test('packed-hierarchy stages are counted with the root included', () => {
  // Thirty-three pages: two leaves of thirty-two and one, then their node. Two stages.
  const pages = Array.from({ length: 33 }, (_, i) => ({ min: [i, 0, 0], max: [i + 1, 1, 1] }))
  const { nodes, stride } = flatHierarchy(pages)
  assert.deepEqual(hierarchyLevelSizes(nodes, stride), [1, 2])
  // One leaf: the root IS the leaf, a single stage.
  const small = flatHierarchy(pages.slice(0, 4))
  assert.deepEqual(hierarchyLevelSizes(small.nodes, small.stride), [1])
  // No page: an empty leaf root, always one stage, never zero passes.
  const empty = flatHierarchy([])
  assert.deepEqual(hierarchyLevelSizes(empty.nodes, empty.stride), [1])
  assert.deepEqual(hierarchyLevelSizes(new Float64Array(0), stride), [])
})
