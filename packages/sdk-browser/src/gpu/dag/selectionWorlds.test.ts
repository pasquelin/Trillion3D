// The cut follows the worlds: a CPU world change leaves the cut in hand one pose late, a root's
// mark reaches the frame word once at the next cut, and worlds the GPU rewrote are cut again once
// announced.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuDagSelection } from './selection.ts'
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { cutOnce, kernelUniforms, packed } from './selectionHelpers.fixture.ts'
import { primitiveWordAt } from './worlds.ts'
import { SHADOWLESS_ROOT } from '../../visibility/shader/shadowlessRoot.ts'
import { moveRoot } from './pack.fixture.ts'
import { packDoubles } from '../../placement/composedMotion.ts'

test('updating an instance world matrix leaves the old GPU cut one pose late', async () => {
  const { fixture, dag, uniforms, selection } = await cutOnce()
  assert.deepEqual([...selection.updateWorlds(moveRoot(dag, 0, 1000))], [0])
  // Still what to stream, cut under the pose before: no image is held on it (`adoption.ts`).
  assert.equal(selection.peek()?.result.pageIds.length, 4)
  assert.notEqual(selection.peek()?.worldRevision, selection.worldRevision)
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 0)
  selection.dispose()
  fixture.geometry.dispose()
})

test('a root mark written once per change reaches the frame word the cut reads', async () => {
  // The mark a root changes reaches the kernel's `markOf` once, at the next cut.
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const { device, rows } = mockDagDevice(dag)
  const selection = await createGpuDagSelection(device, dag)
  assert.ok(selection)
  selection.dispatch(kernelUniforms(dag, roots, wideCamera(), 0))
  await selection.flush()
  const at = primitiveWordAt(0) + 3
  const earlier = rows().length
  for (const mark of [SHADOWLESS_ROOT, SHADOWLESS_ROOT, 0]) selection.markWorld(0, mark)
  assert.deepEqual(rows().slice(earlier), [], 'nothing sent before the next cut')
  assert.equal(dag.mark[0], 0)
  assert.equal(selection.peek(), null, 'the cut in hand is void')
  selection.markWorld(0, SHADOWLESS_ROOT)
  selection.dispatch(kernelUniforms(dag, roots, wideCamera(), 0))
  assert.deepEqual(
    rows()
      .slice(earlier)
      .map(([first, words]) => [first, words[at - first]]),
    [[0, SHADOWLESS_ROOT]],
    'the last word, once, in its row, at the next cut',
  )
  selection.dispose()
  fixture.geometry.dispose()
})

test('worlds the GPU rewrote are cut again once announced, never under the last CPU write', async () => {
  // A parent's turn composed on the GPU (`../../placement/gpuCompose.ts`) changes no CPU world.
  const { fixture, dag, uniforms, selection } = await cutOnce()
  const [range] = selection.worldRanges
  const bytes = (range.buffer as unknown as { data: Uint8Array }).data
  // Its exact translation, which the cut reads at its eye, composed far away.
  packDoubles(
    new Uint32Array(bytes.buffer, bytes.byteOffset, range.count * 24),
    range.count * 16,
    [1000, 0, 0],
  )
  assert.equal(selection.updateWorlds(dag.worlds.slice()).length, 0, 'no CPU world moved')
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 4, 'unannounced: the stale cut')
  selection.worldsMovedOnGpu()
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 0, 'announced: the composed world')
  selection.dispose()
  fixture.geometry.dispose()
})
