// A deformed root's mark word carries its reach in its high sixteen bits (`markReach`, #357): the
// cut holds the whole word, so the same word written again each image — the deformation writes it
// every frame (`deformation/webgpuFrame.ts`) — voids no cut and the image can be held, and the
// primitive's frame words, made again whole from the held words, keep the reach the kernel grows
// every bound by (`reachOf`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuDagSelection } from './selection.ts'
import { dagFixture, wideCamera } from '../../page/selection/dag.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { kernelUniforms, packed } from './selectionHelpers.fixture.ts'
import { primitiveFrameWords, primitiveWordAt } from './worlds.ts'
import { markReach } from '../../deformation/halfFloat.ts'
import { SHADOWLESS_ROOT } from '../../visibility/shader/shadowlessRoot.ts'

test('a reach written again keeps the cut in hand, and the frame words keep the reach', async () => {
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const { device } = mockDagDevice(dag)
  const selection = await createGpuDagSelection(device, dag)
  assert.ok(selection)
  const word = markReach(SHADOWLESS_ROOT, 1.66)
  assert.ok(word > 0xffff, 'the reach lies above the mark')
  selection.markWorld(0, word)
  selection.dispatch(kernelUniforms(dag, roots, wideCamera(), 0))
  await selection.flush()
  const held = selection.peek()
  assert.ok(held, 'a cut under the word')
  for (let image = 0; image < 3; image++) selection.markWorld(0, word)
  assert.equal(selection.peek(), held, 'the same word voids no cut')
  assert.equal(dag.mark[0], word)
  const frame = new Uint32Array(primitiveFrameWords(dag).buffer)
  assert.equal(frame[primitiveWordAt(0) + 3], word, 'the frame words made again keep the reach')
  selection.markWorld(0, markReach(SHADOWLESS_ROOT, 0))
  assert.equal(selection.peek(), null, 'another reach is another cut')
  selection.dispose()
  fixture.geometry.dispose()
})
