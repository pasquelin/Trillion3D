// A parked car (0 km/h) stales no shadow page as moving.
// A car the physics poses writes its placement rows (`physics/placer.ts`): a pose written again
// within a float32 step of the one its shadows last saw — a parked body's pose rounded again, frame
// after frame — has its rows derived without asking their shadow change; a millimetre asks it, the
// car moving already, its moving casters alone (`rowCastWgsl.ts`). The CPU declares no box.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../host/graph/graph.fixture.ts'
import { runtime, selectionRoot } from '../webgpu/core/transformShear.fixture.ts'
import { createPlacementRows, placementWorld } from './rows.ts'
import { updateWebgpuPlacements } from './webgpuPlacements.ts'

test('a parked caster written again within a float32 step stales no page, frame after frame', () => {
  const rows = createPlacementRows(1),
    parked = new G.Matrix4().makeTranslation(40, 2, -25).elements
  rows.matrices.set(parked)
  rows.live[0] = 1
  const root = selectionRoot(new G.Object3D(), [-0.95, 0, -2.3, 0.95, 1.3, 2.3], {
    of: () => placementWorld(rows, 0),
  } as never)
  Object.assign(root, { placement: { rows, index: 0 } })
  const { rt, motions } = runtime(new G.Object3D(), [root])
  Object.assign(rt.blendState, { blendGpu: [] })
  rt.lights.mobility.ensure(1, 1, () => root.world.elements)
  const write = (x: number, turn = 0) => {
    const pose = new G.Matrix4().makeRotationY(turn).setPosition(x, 2, -25).elements
    rows.matrices.set(pose)
    updateWebgpuPlacements(rt, rows, 0, 0)
  }
  const asked = () => rt.rowWords?.roots.length ?? 0
  // Its first move: it turns moving, its rows' change asked.
  write(40.001)
  assert.equal(asked(), 1, 'its first move')
  assert.equal(rt.lights.mobility.moves(0), true)
  // Parked: a hundred frames of the same pose, rounded again by less than a float32 step.
  for (let frame = 0; frame < 100; frame++) write(40.001 + (frame % 2) * 1e-6, (frame % 3) * 1e-9)
  assert.equal(asked(), 1, 'parked: no change asked')
  // Driven on a millimetre: its change asked again, a moving caster's.
  write(40.002)
  assert.equal(asked(), 2, 'a millimetre asks its change')
  assert.deepEqual(motions, [], 'no box declared on the CPU')
})
