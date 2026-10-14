// A deformed water copy: its vertices move past its source box, within the box the deformation's
// reach grows (`wholeBounds.ts`). The rectangle the water pass covers encloses that grown box, so a
// deformed vertex past the source box lies inside it — where a rectangle of the source box, the old
// scissor, clipped it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { updateWholeDeformationBounds } from '../../deformation/wholeBounds.ts'
import { frame, scene } from '../../../../../tests/gpu/water/rectKernel.ts'
import { SIZE } from '../../../../../tests/gpu/water/waterCostScene.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'
import type { SessionDeformation } from '../../deformation/session.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'

/** The pixel of local point `p` of a copy posed by `m`, under `camera`. */
function pixelOf(camera: EngineCamera, m: ArrayLike<number>, p: number[]) {
  const world = [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
  const e = camera.viewProjection
  const clip = [0, 1, 3].map(
    (r) => e[r] * world[0] + e[4 + r] * world[1] + e[8 + r] * world[2] + e[12 + r],
  )
  return [
    ((clip[0] / clip[2]) * 0.5 + 0.5) * SIZE[0],
    (1 - ((clip[1] / clip[2]) * 0.5 + 0.5)) * SIZE[1],
  ]
}

const inside = (rect: number[], [x, y]: number[]) =>
  rect[0] <= x && x <= rect[2] && rect[1] <= y && y <= rect[3]

test('a deformed vertex past the source box lies inside the water rectangle', () => {
  const plain = scene(),
    deformed = scene()
  const { min, max } = deformed.item.sourceGeometry.boundingBox!
  const reach = (max.x - min.x) / 4
  // A vertex the deformation carried a reach past the source box, on its right edge.
  const vertex = [max.x + reach * 0.9, (min.y + max.y) / 2, (min.z + max.z) / 2]
  const at = pixelOf(deformed.camera, deformed.item.matrix.elements, vertex)
  assert.ok(!inside(frame(plain.state, plain.camera).rect, at), 'the source box leaves it out')
  // The deformation's bounds, as the frame updates them (`wholeBounds.ts`).
  deformed.item.deformBounds = new Float64Array(6)
  const rt = {
    blendState: deformed.state,
    lights: { changes: { worldChanged: () => {} } },
    run: {},
  } as unknown as WebgpuPagesRuntime
  const deformation = {
    changedOfWorld: () => true,
    reachOfWorld: () => reach,
  } as unknown as SessionDeformation
  updateWholeDeformationBounds(rt, deformation, false)
  assert.equal(deformed.state.waterItemsMoved, true, 'the water records go up again')
  const covered = frame(deformed.state, deformed.camera)
  assert.equal(covered.drawn, true)
  assert.ok(inside(covered.rect, at), `the deformed vertex at ${at} in ${covered.rect}`)
})
