// The placement tree followed by the cut's run: whatever moved since it was last read — a pose a
// send moved, a park, a mark, a composition — is refitted before the next cut reads it.
// On a generated field of placements.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera, fieldCut, placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { createDagResources } from './resources.ts'
import { createDagRuntime } from './runtime.ts'
import { createSelectionUniforms } from '../core/selection.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

/** A field of `side`² placements cut on a mock device, its tree followed by the run itself
 *  (`createDagRuntime`), the placements `composed` holds composed on the GPU; the bytes each write
 *  of the tree's nodes sends, and `cut`: one dispatch. */
async function followed(side = 40, composed?: ReadonlySet<number>) {
  installGpuGlobals()
  const roots = placementField(side, 6),
    packed = packDagSelection(roots),
    gpu = mockGpu({
      packed,
      limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 28 },
    })
  const resources = (await createDagResources(gpu.device, packed))!
  const selection = createDagRuntime(
    resources,
    undefined,
    composed && ((w: number) => composed.has(w)),
  )
  const writes = () =>
    gpu.writes
      .filter(({ label }) => label?.startsWith('Trillion3D DAG nodes'))
      .map(({ bytes }) => bytes.byteLength)
  const cut = () => selection.dispatch(createSelectionUniforms())
  cut()
  await selection.flush()
  /** The worlds as the host holds them, placement `w` moved a kilometre on. */
  const moved = (w: number) => {
    ;(roots[w].world.elements as Float64Array)[12] += 1000
    const next = packed.worlds.slice()
    next[w * 16 + 12] += 1000
    return next
  }
  return { roots, packed, selection, writes, cut, moved }
}

test('a pose moved is read where it went by the next cut', async () => {
  const { roots, packed, selection, cut, moved } = await followed()
  selection.updateWorlds(moved(70))
  cut()
  const seen = fieldCut(roots, fieldCamera([990, 2, 0], [1000, 0, -50]), true, packed).placements
  assert.ok(seen.includes(70), 'the cut reads the placement at its new pose')
})

test('a pose a send moves refits its group and the nodes above it, never the whole tree', async () => {
  const { roots, packed, selection, writes, cut, moved } = await followed(160)
  const sent = () => writes().reduce((sum, bytes) => sum + bytes, 0),
    nodeBytes = 24 * 4,
    tree = packed.placementTree!.levels.reduce((sum, { count }) => sum + count, 0)
  const before = sent()
  selection.updateWorlds(moved(70), Int32Array.of(70))
  cut()
  // A node per level of the tree, their runs joined: a sixth of its nodes at most.
  const named = sent() - before
  assert.ok(
    named > 0 && named <= (tree / 6) * nodeBytes,
    `${named / nodeBytes} of ${tree} nodes sent`,
  )
  const seen = fieldCut(roots, fieldCamera([990, 2, 0], [1000, 0, -50]), true, packed).placements
  assert.ok(seen.includes(70))
  // A host walk names none: the poses its send moved refit their groups alone, never every box.
  const walked = sent()
  selection.updateWorlds(moved(70))
  cut()
  const refit = sent() - walked
  assert.ok(
    refit > 0 && refit <= (tree / 6) * nodeBytes,
    'the moved one’s group and the nodes above',
  )
})

test('a root its parent composes on the GPU opens its group alone, until it is unlinked', async () => {
  const linked = new Set<number>(),
    { packed, selection, cut } = await followed(40, linked)
  const tree = packed.placementTree!,
    groups = tree.levels.at(-1)!,
    groupOf = (w: number) => Math.floor(tree.slot[w] / 64)
  linked.add(70)
  selection.composedPlacement(70, true)
  selection.worldsMovedOnGpu()
  cut()
  const open = (g: number) => tree.nodeOpen[groups.base + g - tree.cellBase]
  for (let g = 0; g < groups.count; g++)
    assert.equal(open(g), g === groupOf(70) ? 1 : 0, `group ${g}`)
  linked.delete(70)
  selection.composedPlacement(70, false)
  cut()
  assert.equal(open(groupOf(70)), 0, 'unlinked, its group fits its box again')
})

test('a root composed before its cut was followed opens its group at the first cut', async () => {
  const { packed } = await followed(40, new Set([70]))
  const tree = packed.placementTree!,
    groups = tree.levels.at(-1)!
  assert.equal(tree.nodeOpen[groups.base + Math.floor(tree.slot[70] / 64) - tree.cellBase], 1)
})

test('a mark past what a box holds opens its group at the next cut; a park refits it', async () => {
  const { packed, selection, writes, cut } = await followed(40)
  const tree = packed.placementTree!,
    groups = tree.levels.at(-1)!,
    group = groups.base + Math.floor(tree.slot[70] / 64) - tree.cellBase
  selection.markWorld(70, 1 << 16)
  cut()
  assert.equal(tree.nodeOpen[group], 1, 'its reach opens the group')
  const before = writes().length
  selection.parkWorld(70, true)
  cut()
  assert.ok(writes().length > before, 'the parked one’s group fitted again')
})
