// Roots appended in place send what they added: their worlds and exact translations, they alone —
// never every world of the room —, and the tree nodes they joined in the run writer's ranges. On a
// generated field of 1600 placements, 400 appended into a room of 3200.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { dagRootCounts } from './pack.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

test('an append sends the worlds it added, not the room’s', async () => {
  installGpuGlobals()
  const roots = placementField(40, 6),
    counts = dagRootCounts(roots)
  const capacity = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 2 * roots.length }
  const packed = packDagSelection(roots.slice(0, 1200), capacity)
  const gpu = mockGpu({ packed })
  const selection = (await createGpuDagSelection(gpu.device, packed))!
  const before = gpu.writes.length
  assert.equal(selection.appendRoots(roots.slice(1200)), true)
  const sent = gpu.writes
    .slice(before)
    .filter(({ label }) => label === 'Trillion3D DAG worlds')
    .reduce((bytes, { bytes: data }) => bytes + data.byteLength, 0)
  // 400 worlds of 64 bytes and their 32-byte translations, joined into a few writes.
  assert.ok(sent <= 400 * 96 + 2 * 256, `${sent} bytes, the room ${capacity.worlds * 64}`)
  selection.dispose()
})
