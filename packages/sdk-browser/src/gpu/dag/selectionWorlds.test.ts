// The cut follows the worlds: a CPU world change leaves the cut in hand one pose late, a root's
// mark reaches the frame word once at the next cut, and worlds the GPU rewrote are cut again once
// announced.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuDagSelection } from './selection.ts'
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { kernelUniforms, packed } from './selectionHelpers.fixture.ts'
import { primitiveWordAt } from './worlds.ts'
import { SHADOWLESS_ROOT } from '../../visibility/shader/shadowlessRoot.ts'

/** A selection on the fixture, cut once under a wide camera: its four pages in hand. */
async function cutOnce() {
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const uniforms = kernelUniforms(dag, roots, wideCamera(), 0)
  const selection = await createGpuDagSelection(mockDagDevice(dag).device, dag)
  assert.ok(selection)
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 4)
  return { fixture, dag, uniforms, selection }
}

test('updating an instance world matrix leaves the old GPU cut one pose late', async () => {
  const { fixture, dag, uniforms, selection } = await cutOnce()
  const moved = dag.worlds.slice()
  moved[12] = 1000
  assert.equal(selection.updateWorlds(moved), true)
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
  const { device, words } = mockDagDevice(dag)
  const selection = await createGpuDagSelection(device, dag)
  assert.ok(selection)
  selection.dispatch(kernelUniforms(dag, roots, wideCamera(), 0))
  await selection.flush()
  const at = primitiveWordAt(0) + 3
  const earlier = words().length
  for (const mark of [SHADOWLESS_ROOT, SHADOWLESS_ROOT, 0]) selection.markWorld(0, mark)
  assert.deepEqual(words().slice(earlier), [], 'nothing sent before the next cut (CPU-15)')
  assert.equal(dag.mark[0], 0)
  assert.equal(selection.peek(), null, 'the cut in hand is void')
  selection.markWorld(0, SHADOWLESS_ROOT)
  selection.dispatch(kernelUniforms(dag, roots, wideCamera(), 0))
  assert.deepEqual(
    words().slice(earlier),
    [[at, SHADOWLESS_ROOT]],
    'the last word, once, at the next cut',
  )
  selection.dispose()
  fixture.geometry.dispose()
})

test('worlds the GPU rewrote are cut again once announced, never under the last CPU write', async () => {
  // A parent's turn composed on the GPU (`../../placement/gpuCompose.ts`) changes no CPU world.
  const { fixture, dag, uniforms, selection } = await cutOnce()
  const [range] = selection.worldRanges
  const bytes = (range.buffer as unknown as { data: Uint8Array }).data
  new Float32Array(bytes.buffer, bytes.byteOffset, range.count * 16)[12] = 1000
  assert.equal(selection.updateWorlds(dag.worlds.slice()), false, 'no CPU world moved')
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 4, 'unannounced: the stale cut')
  selection.worldsMovedOnGpu()
  selection.dispatch(uniforms)
  assert.equal((await selection.flush())?.pageIds.length, 0, 'announced: the composed world')
  selection.dispose()
  fixture.geometry.dispose()
})
