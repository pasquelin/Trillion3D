// Projection and camera rules, each stated and checked on its own: a projection maps the near
// rectangle's edges to ±1, depth is `near / distance`, every result is finite for finite positive
// inputs, and the camera frame's view-projection keeps a point in front of the eye inside clip.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addTransformNode,
  createCameraFrame,
  createTransformTree,
  perspectiveProjection,
  setNodePosition,
  setNodeQuaternion,
  updateCameraFrame,
  updateNodeMatrixWorld,
} from '../index.ts'
import { near, transformPoint } from './points.fixture.ts'

const FIELDS = [1, 30, 60, 90, 120, 170]
const ASPECTS = [0.25, 1, 16 / 9, 4]
const NEARS = [1e-3, 0.1, 1, 50]
const ZOOMS = [0.1, 1, 2.5]
const eachProjection = (
  body: (p: Float64Array, fov: number, aspect: number, n: number, z: number) => void,
) => {
  for (const fov of FIELDS)
    for (const aspect of ASPECTS)
      for (const n of NEARS)
        for (const z of ZOOMS)
          body(perspectiveProjection(new Float64Array(16), fov, aspect, n, z), fov, aspect, n, z)
}

test('projection: the edges of the near rectangle map to +-1 on both axes, whatever the field, aspect, near and zoom', () => {
  eachProjection((p, fov, aspect, n, zoom) => {
    const hy = (n * Math.tan((fov * Math.PI) / 360)) / zoom
    const hx = aspect * hy
    const [x, y] = transformPoint(p, [hx, hy, -n])
    assert.ok(near(x, 1, 1e-9) && near(y, 1, 1e-9), `${fov} ${aspect} ${n} ${zoom}: ${x} ${y}`)
    const [nx, ny] = transformPoint(p, [-hx, -hy, -n])
    assert.ok(near(nx, -1, 1e-9) && near(ny, -1, 1e-9))
  })
})

test('projection: depth is near / distance, 1 on the near plane, falling toward 0 and never reaching it', () => {
  eachProjection((p, _fov, _aspect, n) => {
    assert.ok(near(transformPoint(p, [0, 0, -n])[2], 1))
    assert.ok(near(transformPoint(p, [0, 0, -4 * n])[2], 0.25))
    const far = transformPoint(p, [0, 0, -1e9 * n])[2]
    assert.ok(far > 0 && far < 1e-8)
  })
})

test('projection: every value is finite for finite positive inputs, and the last column is (0, 0, -1, 0)', () => {
  eachProjection((p) => {
    assert.ok([...p].every(Number.isFinite))
    assert.deepEqual([p[3], p[7], p[11], p[15]], [0, 0, -1, 0])
  })
})

test('projection: a zero zoom collapses the picture scale to 0 and an infinite zoom opens it to infinity, never a NaN', () => {
  const closed = perspectiveProjection(new Float64Array(16), 60, 1.5, 0.1, 0)
  assert.equal(closed[0], 0)
  assert.equal(closed[5], 0)
  assert.ok(![...closed].some(Number.isNaN))
  const open = perspectiveProjection(new Float64Array(16), 60, 1.5, 0.1, Infinity)
  assert.equal(open[5], Infinity)
  assert.equal(open[14], 0.1)
})

test('camera frame: view-projection takes a point in front of the eye, in a rotated and shifted camera, inside clip bounds', () => {
  const tree = createTransformTree(2)
  const cam = addTransformNode(tree)
  setNodePosition(tree, cam, 5, 0, 0)
  setNodeQuaternion(tree, cam, 0, Math.SQRT1_2, 0, Math.SQRT1_2) // yaw 90: looks down -x
  updateNodeMatrixWorld(tree, cam, true)
  const projection = perspectiveProjection(new Float64Array(16), 60, 1, 0.1, 1)
  const frame = updateCameraFrame(createCameraFrame(), projection, tree.worldViews[cam], 1000)
  const [x, y, z] = transformPoint(frame.viewProjection, [-5, 0.2, 0])
  assert.ok(Math.abs(x) <= 1 && Math.abs(y) <= 1 && z > 0 && z < 1, `${x} ${y} ${z}`)
})
