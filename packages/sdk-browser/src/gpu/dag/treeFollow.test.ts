// The placement tree followed by the cut's run: whatever moved since it was last read — a pose a
// send moved, a park, a mark, a composition, an append — is refitted by the one GPU pass before the
// next cut reads it, over the groups it touched alone, its leaves named to the GPU's one writer of
// them. The pass's words are proven bitwise against the CPU fit in `treeRefitWgsl.test.ts`, the
// leaves' in `../../placement/treeLeavesWgsl.test.ts`; here, what is named and encoded, and that no
// leaf is ever taken on the CPU. On a generated field.
import test from 'node:test'
import assert from 'node:assert/strict'
import { placementField } from './placementTree.fixture.ts'
import { packDagSelection } from './pack.ts'
import { createDagResources } from './resources.ts'
import { createDagRuntime, type RootsOnGpu } from './runtime.ts'
import { createSelectionUniforms } from '../core/selection.ts'
import { TREE_REFIT_PASS } from '../../stage/passLabels.ts'
import { BACKEND } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'

/** A field of `side`² placements cut on a mock device, its tree followed by the run itself
 *  (`createDagRuntime`) over a writer of leaves that records what each fit names — `ready` once
 *  the worlds are on the GPU; what the run sent and encoded, and `cut`. */
async function followed(side = 40, ready = { now: true }) {
  installGpuGlobals()
  const roots = placementField(side, 6),
    packed = packDagSelection(roots),
    gpu = fakeDevice({
      ...BACKEND,
      packed,
      limits: { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 2 ** 28 },
    })
  const named: { ranks: number[]; whole: boolean }[] = []
  const onGpu: RootsOnGpu = {
    roots: () => undefined,
    leaves: {
      ready: () => ready.now,
      encode: (_encoder, _tables, { ranks, count, whole }) =>
        void named.push({ ranks: Array.from(ranks.subarray(0, count)), whole }),
    },
  }
  const resources = (await createDagResources(gpu.device, packed))!
  const selection = createDagRuntime(resources, undefined, onGpu)
  const sent = (label: string) =>
    gpu.writes
      .filter((write) => write.buffer.label === label)
      .reduce((n, w) => n + w.data.byteLength, 0)
  const state = () => ({
    leafBytes: sent('Trillion3D placement tree leaf boxes'),
    fits: named.length,
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
  return { packed, selection, state, cut, moved, named }
}

test('no change, no refit: a cut over a still tree sends and encodes nothing', async () => {
  const { state, cut } = await followed()
  const before = state()
  cut()
  assert.deepEqual(state(), before)
})

test('the first fit names every leaf, and no leaf is ever sent from the CPU', async () => {
  const { selection, state, cut, moved, named } = await followed()
  assert.equal(named[0].whole, true, 'every leaf, at the first fit')
  selection.updateWorlds(moved(70), Int32Array.of(70))
  cut()
  assert.equal(named.at(-1)!.whole, false)
  assert.equal(state().leafBytes, 0, 'the leaves are the GPU’s alone')
})

test('nothing fits before the worlds the leaves read are on the GPU', async () => {
  const ready = { now: false },
    { state, cut } = await followed(40, ready)
  assert.equal(state().passes, 0, 'the nodes stay open: no plane rejects them')
  ready.now = true
  cut()
  assert.equal(state().passes, 1, 'the first fit, once they are')
})

test('a pose a send moves refits its group and the nodes above it, never the whole tree', async () => {
  const { packed, selection, state, cut, moved, named } = await followed(160)
  const tree = packed.placementTree!,
    total = tree.levels.reduce((sum, { count }) => sum + count, 0),
    before = state()
  selection.updateWorlds(moved(70), Int32Array.of(70))
  cut()
  let after = state()
  assert.deepEqual(named.at(-1)!.ranks, [70], 'the moved placement’s leaf named')
  assert.equal(after.passes - before.passes, 1, 'one pass')
  assert.equal(after.nodes - before.nodes, tree.levels.length, 'a node per level of the tree')
  assert.ok(tree.levels.length < total / 6)
  // A host walk names none: the poses its send moved refit their groups alone, as a call's.
  const walked = after
  selection.updateWorlds(moved(70))
  cut()
  after = state()
  assert.deepEqual(named.at(-1)!.ranks, [70])
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

test('a root a parent composes has its leaf named like any other, its parent’s move its groups', async () => {
  const { selection, state, cut, named } = await followed(40)
  const before = state()
  selection.composedPlacement(70, true)
  cut()
  const after = state()
  assert.deepEqual(named.at(-1)!.ranks, [70], 'its leaf, from the world the GPU composed')
  assert.equal(after.passes - before.passes, 1)
  // The parent moved: the groups its roots stand in are named, and fit with no placement named.
  const group = selection.groupOf(70)
  assert.ok(group >= 0)
  selection.groupsMoved([group])
  cut()
  assert.equal(state().passes - after.passes, 1)
  assert.deepEqual(named.at(-1)!.ranks, [], 'the composed leaves are the pass’s own list')
  assert.equal(state().nodes - after.nodes, 2 /* levels of a 1600-placement tree */)
})
