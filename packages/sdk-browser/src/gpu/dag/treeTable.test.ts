// The placement tree's one home (`treeTable.ts`): its nodes, its order and its list of members drawn
// whatever the view in one record table, written whole at its making and then by what moved alone —
// the nodes a join rewrote, the member slots it took, a word apiece, the places of the list a mark
// moved. The node and cold tables hold none of it. On a generated field, over the device double.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './pack.ts'
import { dagRootCounts } from './packCapacity.ts'
import { appendDagRoots } from './packAppend.ts'

import { treeNodeCount, TREE_SPAN } from './placementTree.ts'
import { createTreeTable, TREE_TABLE } from './treeTable.ts'
import { DAG_NODE_FLOATS } from './types.ts'
import { recordTable } from '../core/recordTexture.fixture.ts'
import { mirrorKey } from '../../webgpu/cut/denseKeys.ts'
import { SPRITE_UNCULLED } from '../../visibility/shader/spriteWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import type { FakeTexture } from '../../../../../tests/kit/gpu/fakeRecords.ts'

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
