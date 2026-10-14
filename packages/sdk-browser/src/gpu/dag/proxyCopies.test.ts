// The blended copies the forward family draws are members of the run-time proxy after the placements: their
// instances and their poses, followed at each cut. Over the device double.
import { NO_INDEX } from '../../../../math/src/constants.ts'
import { fromF32Bits } from '../../../../math/src/float/bits.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { fieldCamera } from './placementTree.fixture.ts'
import { kernelUniforms } from './selectionHelpers.fixture.ts'
import { cut, instanceAt, open, region, surface, wordAt } from './proxyInstances.fixture.ts'
import { INSTANCE } from '../../bounce/runtimeLayout.ts'
import { WORLD_TABLE } from './worldTable.ts'

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
  // Taken before the cut, as the frame takes them (`dispatchCut`): its prepare holds them.
  selection.proxyCopies(copies)
  selection.dispatch(kernelUniforms(packed, roots, fieldCamera([0, 5, 20], [0, 0, 0]), 1))
  const word = (k: number, j: number) => instanceAt(gpu, slots + k, j)
  const x = (k: number) =>
    new Float32Array([wordAt(gpu, region(gpu, 'copyWorldsWord') + k * 16 + 12)].map((v) => v))[0]
  assert.equal(region(gpu, 'copies'), 3)
  assert.equal(word(0, INSTANCE.node), 0, 'a copy wears the cut the placements share')
  assert.equal(word(1, INSTANCE.node), NO_INDEX, 'a hidden copy draws none')
  assert.equal(word(2, INSTANCE.node), NO_INDEX, 'a copy with no proxy draws none')
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

test('a copy that joins the host’s list in place is counted at the next cut, before it writes the copies', async () => {
  const c = cut(2, 1, 1),
    s = surface(1)
  const { gpu, selection, packed, roots } = await open((w) =>
    w < 2 ? { primitive: { runtimeProxy: c }, surface: s } : undefined,
  )
  const copy = (x: number) => ({
    proxy: { primitive: { runtimeProxy: c }, surface: s },
    matrix: { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]) },
  })
  // The list the engine keeps grows by push: the same array, a longer one.
  const copies = [copy(3)]
  selection.proxyCopies(copies)
  copies.push(copy(5))
  selection.dispatch(kernelUniforms(packed, roots, fieldCamera([0, 5, 20], [0, 0, 0]), 1))
  assert.equal(region(gpu, 'copies'), 2)
  assert.equal(instanceAt(gpu, packed.worldCount + 1, 0), 0, 'the joined copy wears the cut')
  selection.dispose()
})

test('the records grow for the copies at the cut’s prepare, never when the copies are taken', async () => {
  const c = cut(2, 1, 1),
    s = surface(1)
  const { gpu, selection, packed, roots } = await open((w) =>
    w < 2 ? { primitive: { runtimeProxy: c }, surface: s } : undefined,
  )
  const pose = { elements: Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]) }
  // More copies than the table's rows hold beside the placements: it must grow.
  const copies = Array.from({ length: 2000 }, () => ({ matrix: pose }))
  const tables = () => gpu.textures.filter(({ label }) => label === WORLD_TABLE.label).length
  const before = tables()
  // A call that may come mid-frame, once the frame's encoder holds writes to the table.
  selection.proxyCopies(copies)
  assert.equal(tables(), before, 'no growth outside the cut’s prepare')
  selection.dispatch(kernelUniforms(packed, roots, fieldCamera([0, 5, 20], [0, 0, 0]), 1))
  assert.equal(tables(), before + 1, 'grown once, before the cut encodes')
  assert.equal(region(gpu, 'copies'), 2000)
  assert.equal(instanceAt(gpu, packed.worldCount + 1999, INSTANCE.node), NO_INDEX)
  selection.dispose()
})
