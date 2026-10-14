// Roots appended in place send what they added: their worlds and exact translations, they alone —
// never every world of the room —, and the tree nodes and member slots they joined, into the tree's
// own table (`treeTable.ts`). On a generated field of 1600 placements, 400 appended into a room of
// 3200.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { createGpuDagSelection } from './selection.ts'
import { packDagSelection, dagRootCounts } from './pack.ts'

import { BACKEND } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

test('an append sends the worlds it added, not the room’s', async () => {
  installGpuGlobals()
  const roots = placementField(40, 6),
    counts = dagRootCounts(roots)
  const capacity = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 2 * roots.length }
  const packed = packDagSelection(roots.slice(0, 1200), capacity)
  const gpu = fakeDevice({ ...BACKEND, packed })
  const selection = (await createGpuDagSelection(gpu.device, packed))!
  const before = gpu.textureWrites.length
  assert.equal(selection.appendRoots(roots.slice(1200)), true)
  const into = (label: string) =>
    gpu.textureWrites
      .slice(before)
      .filter(({ destination }) => (destination.texture as { label?: string }).label === label)
  const texels = (label: string) =>
    into(label).reduce((sum, { size }) => {
      // The record tables write `[texels, rows, 1]` (`recordTexture.ts`).
      const [w = 1, h = 1, d = 1] = size as number[]
      return sum + w * h * d
    }, 0)
  // 400 worlds of four texels and their translations of two, joined into a few writes.
  const sent = texels('Trillion3D DAG worlds')
  assert.ok(sent > 0 && sent <= 400 * 6 + 2 * 16, `${sent} texels, the room ${capacity.worlds * 6}`)
  // The groups they joined and the 400 member slots they took, in the tree's own table; no node
  // and no word of order in the node or cold tables.
  const tree = texels('Trillion3D DAG placement tree'),
    groups = Math.ceil(400 / 64)
  assert.ok(tree >= 400 && tree <= 400 + groups * 24 + 64, `${tree} words of the tree`)
  selection.dispose()
})
