// A host walk that turned one placement sends that placement alone: its world, its record's matrix
// (`worldTable.ts`) — never every row, never the room a growth keeps —, and no frame row for the
// stretch the turn moved, which the GPU derives from the world it holds
// (`../../placement/rootBoxes.ts`). On a generated field of 1600 placements packed in a room of 3200.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { createGpuDagSelection } from './selection.ts'
import { packDagSelection, dagRootCounts } from './pack.ts'

import { WORLD_TABLE } from './worldTable.ts'
import { FRAME_TABLE } from './frameTable.ts'
import { BACKEND } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

test('a host walk that turned one placement sends its world alone, no stretch', async () => {
  installGpuGlobals()
  const roots = placementField(40, 6),
    counts = dagRootCounts(roots)
  const capacity = { pages: 2 * counts.pages, nodes: 2 * counts.nodes, worlds: 2 * roots.length }
  const packed = packDagSelection(roots, capacity)
  const gpu = fakeDevice({ ...BACKEND, packed })
  const selection = (await createGpuDagSelection(gpu.device, packed))!
  const next = packed.worlds.slice()
  // Placement 70 scaled twice along x: its stretch moves with it, on the GPU.
  next[70 * 16] *= 2
  const texturesBefore = gpu.textureWrites.length
  assert.deepEqual([...selection.updateWorlds(next)], [70], 'the one pose moved')
  // The worlds are a record table (`worldTable.ts`): its matrix alone, four texels of 16 bytes —
  // its translation did not move, no origin goes up.
  const texels = gpu.textureWrites
    .slice(texturesBefore)
    .filter(
      ({ destination }) => (destination.texture as { label?: string }).label === WORLD_TABLE.label,
    )
    .reduce((sum, { size }) => {
      const [w = 1, h = 1, d = 1] = size as number[]
      return sum + w * h * d
    }, 0)
  assert.equal(texels * 16, 64, 'its world')
  const rows = gpu.textureWrites
    .slice(texturesBefore)
    .filter(({ destination }) => destination.texture.label === FRAME_TABLE.label)
  assert.equal(rows.length, 0, 'no frame row: its stretch is the GPU’s')
  selection.dispose()
})
