// The placement tree followed by the cut's run: whatever moved since it was last read — a pose a
// send moved, a park, a mark, a composition, an append — is refitted by the one GPU pass before the
// next cut reads it, over the groups it touched alone. The pass's words are proven bitwise against
// the CPU fit in `treeRefitWgsl.test.ts`; here, what is sent and encoded. On a generated field.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './selection.ts'
import { createDagResources } from './resources.ts'
import { createDagRuntime } from './runtime.ts'
import { createSelectionUniforms } from '../core/selection.ts'
import { TREE_REFIT_PASS } from '../../stage/passLabels.ts'
import { BACKEND, fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import type { ComposedLeaves } from './treeFollow.ts'

/** A field of `side`² placements cut on a mock device, its tree followed by the run itself
 *  (`createDagRuntime`), `composed` holding the placements a composition writes the leaves of;
 *  what the follower sent: the leaf boxes, the nodes of each pass, the passes, and `cut`. */
async function followed(side = 40, composed?: Set<number>) {
  installGpuGlobals()
  const roots = placementField(side, 6),
    packed = packDagSelection(roots),
    gpu = fakeDevice({
      ...BACKEND,
      packed,
      limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 28 },
    })
  const encoded: number[] = []
  const leaves: ComposedLeaves | undefined = composed && {
    has: (w) => composed.has(w),
    encode: () => void encoded.push(composed.size),
  }
  const resources = (await createDagResources(gpu.device, packed))!
  const selection = createDagRuntime(resources, undefined, leaves)
  const sent = (label: string) =>
    gpu.writes
      .filter((write) => write.buffer.label === label)
      .reduce((n, w) => n + w.data.byteLength, 0)
  const state = () => ({
    leaves: sent('Trillion3D placement tree leaf boxes') / 48,
    nodes: sent('Trillion3D placement tree refit ids') / 4,
    passes: gpu.commands.filter((command) => command === `compute ${TREE_REFIT_PASS}`).length,
  })
  const cut = () => selection.dispatch(createSelectionUniforms())
  cut()
  await selection.flush()
  const moved = (w: number) => {
    const next = packed.worlds.slice()
    ;(roots[w].world.elements as Float64Array)[12] += 1000
    next[w * 16 + 12] += 1000
    return next
  }
  return { roots, packed, selection, state, cut, moved, encoded }
}

test('no change, no refit: a cut over a still tree sends and encodes nothing', async () => {
  const { state, cut } = await followed()
  const before = state()
  cut()
  assert.deepEqual(state(), before)
})

test('a pose a send moves refits its group and the nodes above it, never the whole tree', async () => {
  const { packed, selection, state, cut, moved } = await followed(160)
  const tree = packed.placementTree!,
    total = tree.levels.reduce((sum, { count }) => sum + count, 0),
    before = state()
  selection.updateWorlds(moved(70), Int32Array.of(70))
  cut()
  let after = state()
  assert.equal(after.leaves - before.leaves, 1, 'the moved placement’s leaf box sent')
  assert.equal(after.passes - before.passes, 1, 'one pass')
  assert.equal(after.nodes - before.nodes, tree.levels.length, 'a node per level of the tree')
  assert.ok(tree.levels.length < total / 6)
  // A host walk names none: the poses its send moved refit their groups alone, as a call's.
  const walked = after
  selection.updateWorlds(moved(70))
  cut()
  after = state()
  assert.equal(after.leaves - walked.leaves, 1)
  assert.equal(after.nodes - walked.nodes, tree.levels.length)
})

test('a park, a mark past what a box holds, and an append each fit their group at the next cut', async () => {
  const { selection, state, cut } = await followed()
  let before = state()
  selection.markWorld(70, 1 << 16)
  cut()
  assert.equal(state().passes - before.passes, 1, 'the mark')
  before = state()
  selection.parkWorld(70, true)
  cut()
  assert.equal(state().passes - before.passes, 1, 'the park')
  before = state()
  cut()
  assert.equal(state().passes, before.passes, 'a still cut after')
})

test('a root a parent composes has its leaf written by the composition, never by the follower', async () => {
  const linked = new Set<number>(),
    { selection, state, cut, encoded } = await followed(40, linked)
  linked.add(70)
  const first = encoded.length,
    before = state()
  selection.composedPlacement(70, true)
  cut()
  const after = state()
  assert.equal(after.leaves, before.leaves, 'no leaf sent for a composed placement')
  assert.equal(after.passes - before.passes, 1)
  assert.equal(encoded.length - first, 1, 'the composition encodes its leaves before the pass')
  // The parent moved: the groups its roots stand in are named, and fit with no placement named.
  const group = selection.groupOf(70)
  assert.ok(group >= 0)
  selection.groupsMoved([group])
  cut()
  assert.equal(state().passes - after.passes, 1)
  assert.equal(state().nodes - after.nodes, 2 /* levels of a 1600-placement tree */)
  // Unlinked, the host's pose is written again and its leaf is sent from the box.
  linked.delete(70)
  const unlinked = state()
  selection.composedPlacement(70, false)
  cut()
  assert.equal(state().leaves - unlinked.leaves, 1)
})
