// The placement tree's one home (`treeTable.ts`): its nodes, its order and its list of members drawn
// whatever the view in one record table, written whole at its making and then by what moved alone —
// the nodes a join rewrote, the member slots it took, a word apiece, the places of the list a mark
// moved. The node and cold tables hold none of it. On a generated field, over the device double.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from '../placement/placementTree.fixture.ts'
import { packDagSelection } from '../pack/pack.ts'
import { dagRootCounts } from '../pack/packCapacity.ts'
import { appendDagRoots } from '../pack/packAppend.ts'

import { treeNodeCount, TREE_SPAN } from '../placement/placementTree.ts'
import { createTreeTable, TREE_TABLE } from './treeTable.ts'
import { DAG_NODE_FLOATS } from '../types.ts'
import {
  NODE_CHILD_COUNT,
  NODE_FIRST_CHILD,
  NODE_FLOOR,
  NODE_KIND,
  NODE_MAX,
  NODE_MIN,
  NODE_WORLD,
  PARENT_ERROR,
  PARENT_SPHERE,
  TREE_DRAW_FAR,
  TREE_DRAW_NEAR,
  TREE_PARENT_ERROR,
  TREE_PARENT_SPHERE,
} from '../nodeLayout.ts'
import { recordTable } from '../../../gpu/core/recordTexture.fixture.ts'
import { mirrorKey } from '../../cut/adoption/denseKeys.ts'
import { SPRITE_UNCULLED } from '../../../visibility/shader/spriteWgsl.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import type { FakeTexture } from '../../../../../../tests/kit/fakeDevice/fakeRecords.ts'

/** The words the device holds of `table`, read as the record table they are. */
const held = (table: ReturnType<typeof createTreeTable>, records: number) =>
  recordTable(TREE_TABLE, records, (table.texture as unknown as FakeTexture).words)

test('the tree’s nodes, order and list lie in its own table, none in the node or cold tables', () => {
  installGpuGlobals()
  const roots = placementField(40, 6)
  roots[70] = { ...roots[70], mark: SPRITE_UNCULLED }
  const dag = packDagSelection(roots),
    tree = dag.placementTree!,
    nodes = treeNodeCount(tree)
  assert.equal(dag.nodes.length, dag.primitiveNodeCount * DAG_NODE_FLOATS, 'the placements’ alone')
  assert.equal(dag.nodeCount, dag.primitiveNodeCount + nodes, 'the tree named past them')
  const { device } = fakeDevice()
  const table = createTreeTable(device, tree),
    words = held(table, nodes)
  const nodeWords = new Uint32Array(tree.nodes.buffer, tree.nodes.byteOffset, tree.nodes.length)
  for (let n = 0; n < nodes; n++)
    assert.deepEqual(
      Array.from(words.get('Node', n)),
      Array.from(nodeWords.subarray(n * DAG_NODE_FLOATS, (n + 1) * DAG_NODE_FLOATS)),
      `node ${n}`,
    )
  for (let k = 0; k < tree.capacity; k++)
    assert.equal(words.get('Members', Math.floor(k / TREE_SPAN))[k % TREE_SPAN], tree.order[k])
  const { set } = tree.always
  assert.equal(set.count, 1, 'the never culled listed')
  for (let j = 0; j < set.count; j++)
    assert.equal(words.get('Always', Math.floor(j / TREE_SPAN))[j % TREE_SPAN], set.list[j])
})

test('a join writes the nodes it rewrote and the member slots it took, a word apiece', () => {
  installGpuGlobals()
  const roots = placementField(10, 6),
    counts = dagRootCounts(roots)
  const capacity = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 160 }
  const dag = packDagSelection(roots.slice(0, 80), capacity),
    tree = dag.placementTree!
  const gpu = fakeDevice()
  const table = createTreeTable(gpu.device, tree),
    before = gpu.textureWrites.length
  const added = appendDagRoots(dag, roots.slice(80))!
  table.writeNodes(added.tree.nodes)
  table.writeMembers(...added.tree.members)
  const writes = gpu.textureWrites.slice(before),
    texels = writes.reduce((sum, { size }) => sum + (size as number[])[0], 0)
  // A new group of twenty members: its node, then its twenty slots — none of the eighty before.
  assert.deepEqual(added.tree.members, [128, 148])
  assert.equal(texels, DAG_NODE_FLOATS + 20, 'the node and the slots, a word apiece')
  const words = held(table, treeNodeCount(tree))
  for (let k = 128; k < 148; k++)
    assert.equal(words.get('Members', Math.floor(k / TREE_SPAN))[k % TREE_SPAN], tree.order[k])
})

test('a mark that moves the list writes the places it moved alone', () => {
  installGpuGlobals()
  const dag = packDagSelection(placementField(40, 6)),
    tree = dag.placementTree!
  const gpu = fakeDevice()
  const table = createTreeTable(gpu.device, tree),
    before = gpu.textureWrites.length
  table.writeAlways()
  assert.equal(gpu.textureWrites.length, before, 'a still list writes nothing')
  mirrorKey(tree.always, 70, true)
  mirrorKey(tree.always, 900, true)
  table.writeAlways()
  const words = held(table, treeNodeCount(tree)).get('Always', 0)
  assert.deepEqual(Array.from(words.subarray(0, 2)), [70, 900])
})

// A node of the table means what its kind says: a group of the tree holds its box, its links, the
// distances its placements are drawn at and, in words of their own, the world ball of its instances'
// parent groups and their greatest error; a record of one group above an instance's root holds its
// error and ball and its kind. No two of these share a word in the node they lie in.
test('the words a tree group and a parent record hold their ball and error in are no other word of their kind', () => {
  const span = (from: number, count: number) => Array.from({ length: count }, (_, k) => from + k)
  const group = [
    ...span(NODE_MIN, 3),
    ...span(NODE_MAX, 3),
    ...[NODE_FIRST_CHILD, NODE_CHILD_COUNT, NODE_WORLD, NODE_FLOOR, NODE_KIND],
    ...[TREE_DRAW_NEAR, TREE_DRAW_FAR],
  ]
  const ball = [TREE_PARENT_ERROR, ...span(TREE_PARENT_SPHERE, 4)]
  assert.equal(new Set([...group, ...ball]).size, group.length + ball.length)
  const record = [PARENT_ERROR, ...span(PARENT_SPHERE, 4)]
  assert.ok(!record.includes(NODE_KIND), 'the kind of a record is its own word')
  for (const word of [...group, ...ball, ...record]) assert.ok(word < DAG_NODE_FLOATS)
})
