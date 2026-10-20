// A deformed root's mark word carries its reach in its high sixteen bits (`rootMark`): the
// cut holds the whole word, so the same word written again each image — the deformation writes it
// every frame (`deformation/webgpuFrame.ts`) — voids no cut and the image can be held, and the
// primitive's frame words, made again whole from the held words, keep the reach the kernel grows
// every bound by (`reachOf`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuDagSelection } from './selection/selection.ts'
import { dagFixture, wideCamera } from '../selection/dag.fixture.ts'
import { mockDagDevice } from './selection/selection.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { kernelUniforms, packed } from './selection/selectionHelpers.fixture.ts'
import { primitiveFrameWords, primitiveWordAt } from './worlds/worlds.ts'
import { rootMark } from '../../deformation/halfFloat.ts'
import { SHADOWLESS_ROOT } from '../../visibility/shader/shadowlessRoot.ts'
import { hostStretches } from './hostStretches.fixture.ts'
import { MARK_WORD } from './frameTable.ts'

test('a reach written again or moved keeps the cut in hand, and the frame words keep the reach', async () => {
  installGpuGlobals()
  const fixture = dagFixture()
  const { dag, roots } = packed(fixture)
  const { device } = mockDagDevice(dag)
  const selection = await createGpuDagSelection(device, dag, { roots: hostStretches(dag) })
  assert.ok(selection)
  const word = rootMark({ mark: SHADOWLESS_ROOT, reach: 1.66 })
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
  assert.equal(
    frame[primitiveWordAt(0) + MARK_WORD],
    word,
    'the frame words made again keep the reach',
  )
  // A skinned or simulated root reaches another distance every image it moves: the cut in hand
  // stays adoptable, a frame late as under a pose that moved — voided, no cut would ever be
  // adopted and the session's first image never shown.
  selection.markWorld(0, rootMark({ mark: SHADOWLESS_ROOT, reach: 0.4 }))
  assert.equal(selection.peek(), held, 'another reach keeps the cut in hand')
  selection.markWorld(0, rootMark({ mark: 0, reach: 0.4 }))
  assert.equal(selection.peek(), null, 'another mark is another cut')
  selection.dispose()
  fixture.geometry.dispose()
})
