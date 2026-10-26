// A parked car (0 km/h) is no move of its placement.
// A car the physics poses writes its placement rows (`physics/placer.ts`): a pose written again
// within a float32 step of the one its mobility last saw — a parked body's pose rounded again, frame
// after frame — is no move of its mobility (`ShadowMobility.move`): the world sent is the one drawn;
// a millimetre is a move again, the car moving already. The CPU declares no box.
import test from 'node:test'
import assert from 'node:assert/strict'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { runtime, selectionRoot } from '../gpu/core/transformShear.fixture.ts'
import { createPlacementRows, placementWorld } from './rows/rows.ts'
import { updateWebgpuPlacements } from './webgpuPlacements.ts'

test('a parked caster written again within a float32 step is no move, frame after frame', () => {
  const rows = createPlacementRows(1),
    parked = new Matrix4().makeTranslation(40, 2, -25).elements
  rows.matrices.set(parked)
  rows.live[0] = 1
  const root = selectionRoot(new Object3D(), [-0.95, 0, -2.3, 0.95, 1.3, 2.3], {
    of: () => placementWorld(rows, 0),
  } as never)
  Object.assign(root, { placement: { rows, index: 0 } })
  const { rt, motions } = runtime(new Object3D(), [root])
  Object.assign(rt.blendState, { blendGpu: [] })
  rt.lights.mobility.ensure(1, () => root.world.elements)
  const write = (x: number, turn = 0) => {
    const pose = new Matrix4().makeRotationY(turn).setPosition(x, 2, -25).elements
    rows.matrices.set(pose)
    updateWebgpuPlacements(rt, rows, 0, 0)
  }
  // The moves the mobility was told of since the last look.
  const { mobility } = rt.lights,
    told = mobility.move
  let moves = 0
  mobility.move = ((...args: Parameters<typeof told>) => {
    moves++
    return told.apply(mobility, args)
  }) as typeof told
  const asked = () => {
    const taken = moves
    moves = 0
    return taken
  }
  // Its first move: it turns moving.
  write(40.001)
  assert.equal(asked(), 1, 'its first move')
  assert.equal(rt.lights.mobility.moves(0), true)
  // Parked: a hundred frames of the same pose, rounded again by less than a float32 step.
  for (let frame = 0; frame < 100; frame++) write(40.001 + (frame % 2) * 1e-6, (frame % 3) * 1e-9)
  assert.equal(asked(), 0, 'parked: no move')
  // Driven on a millimetre: a move again, a moving caster's.
  write(40.002)
  assert.equal(asked(), 1, 'a millimetre is a move')
  assert.deepEqual(motions, [], 'no box declared on the CPU')
})
