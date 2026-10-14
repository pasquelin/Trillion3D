// A pose a call named sends what moved of it — its exact translation, its world when it turned —,
// and no other placement's: a frame's upload follows what moved, never the placements' count.
// On a generated field.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { createGpuDagSelection } from './selection.ts'
import { packDagSelection } from './pack.ts'
import { BACKEND } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

test('a named pose sends its world and its translation alone, each where its record holds it', async () => {
  installGpuGlobals()
  const roots = placementField(40, 6),
    packed = packDagSelection(roots)
  const gpu = fakeDevice({ ...BACKEND, packed })
  const selection = await createGpuDagSelection(gpu.device, packed)
  assert.ok(selection)
  const worlds = packed.worlds.slice()
  /** The texels of the worlds' table the writes since `from` sent: their first, their count. */
  const sentSince = (from: number) =>
    gpu.textureWrites
      .slice(from)
      .filter(({ destination }) => destination.texture.label === 'Trillion3D DAG worlds')
      .map(({ destination, size }) => [(destination.origin as number[])[0], (size as number[])[0]])
  ;(roots[70].world.elements as Float64Array)[12] += 1
  worlds.set(roots[70].world.elements, 70 * 16)
  const before = gpu.textureWrites.length
  assert.deepEqual(
    [...selection.updateWorlds(worlds, Int32Array.of(3, 70))],
    [70],
    'the one that moved',
  )
  // Placement 3 was named and did not move: nothing of it goes up. The exact translations lie
  // behind the row's 1024 matrices, two texels each (`worldTable.ts`).
  assert.deepEqual(
    sentSince(before),
    [[4096 + 70 * 2, 2]],
    'its translation alone — its linear part stood —: 32 bytes of 1600 placements',
  )
  // A turn sends its world too: the words a cut reads of it moved.
  ;(roots[70].world.elements as Float64Array)[0] = 2
  worlds.set(roots[70].world.elements, 70 * 16)
  const turned = gpu.textureWrites.length
  selection.updateWorlds(worlds, Int32Array.of(70))
  assert.deepEqual(sentSince(turned), [[70 * 4, 4]])
  selection.dispose()
})
