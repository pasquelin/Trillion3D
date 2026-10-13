// A link is never refused for what reads its row: waves, a soft body or a skeleton read the root's
// composed world; a row no root reads is composed for its readers, and handed to the roots pass once
// a growth brings it a root.
import { NO_INDEX } from '../../../math/src/constants.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeWebgpuPlacements, rebindComposedWorlds } from './gpuCompose.ts'
import { createPlacementRows, placementWorld } from './rows.ts'
import { forgetRowRoots } from './update.ts'
import { multiplyMatrix4 } from '../../../math/src/matrix/matrix4.ts'
import { session, turn } from './composeSession.fixture.ts'

const local = (x: number) => turn(0).map((v, k) => (k === 12 ? x : v))
const product = (parent: number[], child: number[]) =>
  Array.from(
    multiplyMatrix4(new Float64Array(16), Float64Array.from(parent), Float64Array.from(child)),
  )

test('a row deformed by waves, a soft body or a skeleton is linked: the root it is read through composes', () => {
  const { rt, rows } = session()
  rows.sources = [{ waves: {} }, { softSource: {}, skeleton: {} }] as unknown as typeof rows.sources
  const links = [0, 1].map((index) => ({ rows, index, local: turn(0) }))
  composeWebgpuPlacements(rt, {}, turn(0.2), links, true)
  assert.deepEqual([...rt.compose!.parentOf], [0, 0])
  // The world a deformation reads is the parent's times the local, as the roots read it.
  const world = rt.layout.selectionRoots[0].world.elements
  assert.deepEqual(Array.from(world), product(turn(0.2), turn(0)))
})

test('a parent with no row held and none given has nothing to follow: no refusal', () => {
  const { rt } = session()
  composeWebgpuPlacements(rt, {}, turn(0), [], false)
  composeWebgpuPlacements(rt, {}, turn(0), [], true)
})

test('a row no root reads is composed for its readers, and a root a growth brings takes it over', () => {
  const { rt, rows } = session()
  const extra = createPlacementRows(3),
    pending = createPlacementRows(2),
    parent = {}
  // A blended item reads row 1 of `extra` through its view, as the blend pass reads its copies.
  const item = { placement: { rows: extra, index: 1 }, matrix: placementWorld(extra, 1) }
  rt.blendState.blendGpu.push(item as never)
  const links = [
    { rows, index: 0, local: turn(0) },
    { rows: extra, index: 1, local: local(5) },
    // A row whose root a growth has not built yet: no view reads it.
    { rows: pending, index: 0, local: local(7) },
  ]
  composeWebgpuPlacements(rt, parent, turn(0.3), links, true)
  assert.deepEqual(Array.from(item.matrix.elements), product(turn(0.3), local(5)))
  // The parent turns: the reader's row follows it, composed when it is read.
  composeWebgpuPlacements(rt, parent, turn(0.6), [], false)
  assert.deepEqual(Array.from(item.matrix.elements), product(turn(0.6), local(5)))
  // A growth builds the roots of both rows: the roots pass composes them from now on. The row a
  // blended copy reads stays composed for that copy too (`linkedRanks`): the other leaves this
  // module.
  const roots = rt.layout.selectionRoots as unknown as object[]
  roots.push({ placement: { rows: pending, index: 0 }, world: placementWorld(pending, 0) })
  roots.push({ placement: { rows: extra, index: 1 }, world: placementWorld(extra, 1) })
  forgetRowRoots(roots as never)
  rebindComposedWorlds(rt)
  assert.deepEqual([...rt.compose!.parentOf].slice(0, 4), [0, NO_INDEX, 0, 0])
  const held = [...rt.compose!.readers.values()].flat()
  assert.deepEqual(
    held.map(({ rows: read, index }) => [read === extra, index]),
    [[true, 1]],
    'the blended copy’s row alone is left to this module',
  )
  assert.deepEqual(Array.from(item.matrix.elements), product(turn(0.6), local(5)))
})

test("a parent's move composes no reader's row: the product waits for a read, one a read", () => {
  const { rt } = session()
  const extra = createPlacementRows(3),
    parent = {}
  const item = { placement: { rows: extra, index: 2 }, matrix: placementWorld(extra, 2) }
  rt.blendState.blendGpu.push(item as never)
  composeWebgpuPlacements(rt, parent, turn(0.1), [{ rows: extra, index: 2, local: local(1) }], true)
  const row = () => Array.from(extra.matrices.subarray(32, 48))
  const read = row()
  composeWebgpuPlacements(rt, parent, turn(0.9), [], false)
  composeWebgpuPlacements(rt, parent, turn(1.2), [], false)
  assert.deepEqual(row(), read, 'two moves: the row is not written')
  assert.deepEqual(Array.from(item.matrix.elements), product(turn(1.2), local(1)))
  assert.deepEqual(row(), product(turn(1.2), local(1)), 'read once: composed at the last world')
})
