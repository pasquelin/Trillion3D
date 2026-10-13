// A link is never refused for what reads its row: waves, a soft body or a skeleton read the root's
// composed world; a row no root reads is composed for its readers, and handed to the roots pass once
// a growth brings it a root.
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeWebgpuPlacements, rebindComposedWorlds } from './gpuCompose.ts'
import { NONE } from './gpuComposeWgsl.ts'
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
    parent = {}
  const links = [
    { rows, index: 0, local: turn(0) },
    { rows: extra, index: 1, local: local(5) },
  ]
  composeWebgpuPlacements(rt, parent, turn(0.3), links, true)
  assert.deepEqual(Array.from(placementWorld(extra, 1).elements), product(turn(0.3), local(5)))
  // The parent turns: the reader's row follows it.
  composeWebgpuPlacements(rt, parent, turn(0.6), [], false)
  assert.deepEqual(Array.from(placementWorld(extra, 1).elements), product(turn(0.6), local(5)))
  // A growth builds the root of that row: the roots pass composes it from now on.
  const roots = rt.layout.selectionRoots as unknown as object[]
  roots.push({ placement: { rows: extra, index: 1 }, world: placementWorld(extra, 1) })
  forgetRowRoots(roots as never)
  rebindComposedWorlds(rt)
  assert.deepEqual([...rt.compose!.parentOf].slice(0, 3), [0, NONE, 0])
  assert.equal(rt.compose!.readers.size, 0, 'no reader is left to this module')
})
