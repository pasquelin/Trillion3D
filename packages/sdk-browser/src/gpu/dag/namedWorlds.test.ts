// A pose a call named sends what moved of it — its exact translation, its world when it turned —,
// and no other placement's: a frame's upload follows what moved, never the placements' count.
// On a generated field.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { createGpuDagSelection, packDagSelection } from './selection.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

test('a named pose sends its world and its translation alone, each where its range holds it', async () => {
  installGpuGlobals()
  const roots = placementField(40, 6),
    packed = packDagSelection(roots)
  const gpu = mockGpu({ packed })
  const selection = await createGpuDagSelection(gpu.device, packed)
  assert.ok(selection)
  const [range] = selection.worldRanges
  const worlds = packed.worlds.slice()
  ;(roots[70].world.elements as Float64Array)[12] += 1
  worlds.set(roots[70].world.elements, 70 * 16)
  const before = gpu.writes.length
  assert.deepEqual(
    [...selection.updateWorlds(worlds, Int32Array.of(3, 70))],
    [70],
    'the one that moved',
  )
  const sent = gpu.writes.slice(before).filter(({ label }) => label === 'Trillion3D DAG worlds')
  // Placement 3 was named and did not move: nothing of it goes up.
  assert.deepEqual(
    sent.map(({ offset, bytes }) => [offset, bytes.byteLength]),
    [[range.count * 64 + 70 * 32, 32]],
    'its translation alone — its linear part stood —: 32 bytes of 1600 placements',
  )
  // A turn sends its world too: the words a cut reads of it moved.
  ;(roots[70].world.elements as Float64Array)[0] = 2
  worlds.set(roots[70].world.elements, 70 * 16)
  const turned = gpu.writes.length
  selection.updateWorlds(worlds, Int32Array.of(70))
  assert.deepEqual(
    gpu.writes
      .slice(turned)
      .filter(({ label }) => label === 'Trillion3D DAG worlds')
      .map(({ offset, bytes }) => [offset, bytes.byteLength]),
    [[70 * 64, 64]],
  )
  selection.dispose()
})
