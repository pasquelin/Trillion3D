// The blended copies the forward family draws are members of the run-time proxy after the placements: their
// instances and their poses, followed at each cut. Over the device double.
import { fromF32Bits } from '../../../../math/src/float/bits.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera } from './placementTree.fixture.ts'
import { kernelUniforms } from './selectionHelpers.fixture.ts'
import { cut, open, region, surface, wordAt } from './proxyInstances.fixture.ts'
import { INSTANCE, INSTANCE_WORDS, RUNTIME_NONE } from '../../bounce/runtimeLayout.ts'

test('blended copies are members after the placements: their instances and their poses, followed at each cut', async () => {
  const c = cut(2, 1, 1),
    s = surface(1)
  const { gpu, selection, packed, roots } = await open((w) =>
    w < 2 ? { primitive: { runtimeProxy: c }, surface: s } : undefined,
  )
  const slots = packed.worldCount
  const pose = (x: number) => ({
    elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]),
  })
  const copies = [
    { proxy: { primitive: { runtimeProxy: c }, surface: s }, matrix: pose(3) },
    { proxy: { primitive: { runtimeProxy: c }, surface: s }, matrix: pose(5), hidden: true },
    { matrix: pose(7) },
  ]
  selection.proxyCopies(copies)
  const word = (k: number, j: number) =>
    wordAt(gpu, region(gpu, 'instancesWord') + (slots + k) * INSTANCE_WORDS + j)
  const x = (k: number) =>
    new Float32Array([wordAt(gpu, region(gpu, 'copyWorldsWord') + k * 16 + 12)].map((v) => v))[0]
  assert.equal(region(gpu, 'copies'), 3)
  assert.equal(word(0, INSTANCE.node), 0, 'a copy wears the cut the placements share')
  assert.equal(word(1, INSTANCE.node), RUNTIME_NONE, 'a hidden copy draws none')
  assert.equal(word(2, INSTANCE.node), RUNTIME_NONE, 'a copy with no proxy draws none')
  assert.equal(fromF32Bits(wordAt(gpu, region(gpu, 'copyWorldsWord') + 12)), 3)
  void x
  // The host moves it and shows the hidden one: the next cut writes both.
  copies[0].matrix.elements[12] = 4
  copies[1].hidden = false
  selection.dispatch(kernelUniforms(packed, roots, fieldCamera([0, 5, 20], [0, 0, 0]), 1))
  assert.equal(fromF32Bits(wordAt(gpu, region(gpu, 'copyWorldsWord') + 12)), 4)
  assert.equal(word(1, INSTANCE.node), 0)
  selection.dispose()
})
