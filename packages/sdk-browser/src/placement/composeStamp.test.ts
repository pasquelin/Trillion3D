// A composed root's world stamp — the key every memo of what derives from its world is taken by —
// moves only when its parent's world or a link does: a still parent sent again every frame leaves
// every composed world and every memo whole.
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeWebgpuPlacements } from './gpuCompose.ts'
import { session, turn } from './composeSession.fixture.ts'

test("a still parent sent again keeps its roots' world stamp; a move, a link move it", () => {
  const { rt, rows } = session()
  const parent = {},
    links = [0, 1].map((index) => ({ rows, index, local: turn(0.25) }))
  composeWebgpuPlacements(rt, parent, turn(0), links, true)
  const stamp = () =>
    (rt.layout.selectionRoots[1] as never as { world: { stamp: number } }).world.stamp
  const linked = stamp()
  composeWebgpuPlacements(rt, parent, turn(0), [], false)
  composeWebgpuPlacements(rt, parent, turn(0), [], false)
  assert.equal(stamp(), linked, 'a still parent leaves the stamp')
  composeWebgpuPlacements(rt, parent, turn(0.5), [], false)
  const moved = stamp()
  assert.notEqual(moved, linked, 'a move moves it')
  composeWebgpuPlacements(rt, parent, turn(0.5), [{ rows, index: 1, local: turn(0.75) }], false)
  assert.notEqual(stamp(), moved, 'a link at a new local moves it')
})
