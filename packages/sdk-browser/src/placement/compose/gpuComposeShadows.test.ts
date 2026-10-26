// A parent composed on the GPU moves its children with no CPU row write. The CPU declares no box of
// the move: its first move makes the children moving casters, and at rest every child turns static
// on its own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeWebgpuPlacements } from './gpuCompose.ts'
import { composeRuntime } from './composeRuntime.fixture.ts'
import { createPlacementRows } from '../rows/rows.ts'

/** A parent's world: a translation to `x` along the first axis. */
const at = (x: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]

test("a linked parent's move declares no CPU box: its children turn moving, then static each on its own", () => {
  const rows = createPlacementRows(2)
  const rt = composeRuntime(
    [0, 1].map((index) => ({
      placement: { rows, index },
      world: { elements: new Float32Array(at(index * 2)) },
      localBox: Float64Array.from([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]),
    })),
  )
  const { mobility, changes } = rt.lights
  mobility.ensure(2, (rank) => rt.layout.selectionRoots[rank].world.elements)
  const parent = {},
    links = [0, 1].map((index) => ({ rows, index, local: at(index * 2) }))
  composeWebgpuPlacements(rt, parent, at(0), links, true)
  composeWebgpuPlacements(rt, parent, at(0), [], false)
  assert.equal(mobility.moves(0) || mobility.moves(1), false, 'a still parent moves nothing')

  composeWebgpuPlacements(rt, parent, at(10), [], false)
  assert.equal(mobility.moves(0) && mobility.moves(1), true, 'its first move: moving casters')
  composeWebgpuPlacements(rt, parent, at(11), [], false)
  assert.equal(changes.count(), 0, 'no move declared a box on the CPU')

  // At rest past the threshold, each child turns static, handed on its own.
  for (let frame = 0; frame < 5; frame++) mobility.settle(3)
  assert.equal(mobility.moves(0) || mobility.moves(1), false, 'each child turned static')
  composeWebgpuPlacements(rt, parent, at(12), [], false)
  assert.equal(mobility.moves(0) && mobility.moves(1), true, 'the next move promotes them again')
  assert.equal(changes.count(), 0)
})
