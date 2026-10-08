// A host walk that turned one placement sends that placement alone: its world, and its frame row
// for the stretch the turn moved — never every row, never the room a growth keeps. On a generated
// field of 1600 placements packed in a room of 3200.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { dagRootCounts } from './pack.ts'
import { FRAME_VEC4 } from './types.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

test('a host walk that turned one placement sends its world and its row alone', async () => {
  installGpuGlobals()
  const roots = placementField(40, 6),
    counts = dagRootCounts(roots)
  const capacity = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 2 * roots.length }
  const packed = packDagSelection(roots, capacity)
  const gpu = mockGpu({ packed })
  const selection = (await createGpuDagSelection(gpu.device, packed))!
  const next = packed.worlds.slice()
  // Placement 70 scaled twice along x: its stretch moves with it.
  next[70 * 16] *= 2
  const before = gpu.writes.length
  assert.deepEqual([...selection.updateWorlds(next)], [70], 'the one pose moved')
  const bytes = (label: string) =>
    gpu.writes
      .slice(before)
      .filter((write) => write.label === label)
      .reduce((sum, { bytes: data }) => sum + data.byteLength, 0)
  assert.equal(bytes('Trillion3D DAG worlds'), 64, 'its world')
  assert.ok(bytes('Trillion3D DAG frames') <= FRAME_VEC4 * 16, 'its frame row, no other')
  selection.dispose()
})
