import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeformationFrame } from './frame.ts'
import { deformedOf } from './source.ts'
import { recordLayout } from './layout.ts'
import { updateWebgpuDeformation } from './webgpuFrame.ts'
import { counted } from './skinPalettes.fixture.ts'
import { deformationRuntime } from './deformationRuntime.fixture.ts'
import { PALETTE_FLOATS, Skeleton } from '../../../sdk-core/src/world/animation/skeleton.ts'
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { Matrix4 } from '../../../sdk-core/src/world/math/matrix4.ts'
import type { EngineCamera } from '../camera/world.ts'
import type { PageRec } from '../page/selection/selection.ts'
import { HALF_PI } from '../../../math/src/constants.ts'

test('a still rig turned static, its palette held, stales its shadows the frame a bone moves', () => {
  const root = new Object3D(),
    bones = [new Object3D(), new Object3D()]
  root.add(bones[0].add(bones[1]))
  bones[1].position.set(0, 1, 0)
  root.updateMatrixWorld()
  const world = new Matrix4(),
    mesh = { skeleton: new Skeleton(bones) },
    placed = deformedOf(
      mesh,
      { deformation: { joints: [0, 0.5, 0, 0.5, 0, 1.5, 0, 0.5], targets: [] } },
      world,
    )!,
    frame = createDeformationFrame([placed]),
    count = counted(mesh.skeleton)
  const rec = { min: [-1, -1, -1], max: [1, 2, 1] } as unknown as PageRec
  const box = () => new Float64Array([-1, -1, -1, 1, 2, 1])
  const { rt, changed: staled } = deformationRuntime(
    world,
    frame,
    [{ world, pages: [rec], reach: 0, packedBase: 0, localBox: box(), worldBox: box() }],
    {
      pageTableFloats: new Float32Array(64),
      packedCount: 1,
      rowOfPage: [0],
      packedPageIndex: [0],
      markRowWords() {},
    },
  )
  const camera = { projection: world.elements } as EngineCamera
  const at = recordLayout(placed.shape).palette + PALETTE_FLOATS
  updateWebgpuDeformation(rt, camera)
  assert.equal(staled.length, 1, 'the first pose stales its shadows')
  for (let f = 0; f < 5; f++) {
    root.updateMatrixWorld()
    updateWebgpuDeformation(rt, camera)
  }
  assert.equal(count.writes, 1, 'the still frames write no palette')
  assert.equal(staled.length, 1, 'nor stale any shadow')
  assert.equal(frame.dirty[0], 0)
  bones[1].quaternion.setFromAxisAngle({ x: 0, y: 0, z: 1 }, HALF_PI)
  root.updateMatrixWorld()
  updateWebgpuDeformation(rt, camera)
  assert.equal(count.writes, 2, 'the frame a bone moves writes the palette')
  assert.ok(Math.abs(frame.block[at] - 0) < 1e-6 && Math.abs(frame.block[at + 4] - 1) < 1e-6)
  assert.equal(frame.dirty[0], 1)
  assert.equal(frame.moving[0], 1)
  assert.equal(staled.length, 2, 'and stales its shadows that same frame')
  root.updateMatrixWorld()
  updateWebgpuDeformation(rt, camera)
  assert.equal(count.writes, 3, 'the next frame reads every bone again')
  assert.equal(frame.dirty[0], 0)
  assert.equal(staled.length, 2, 'nor stales its shadows again')
  root.updateMatrixWorld()
  updateWebgpuDeformation(rt, camera)
  assert.equal(count.writes, 3, 'then holds the new palette')
})
