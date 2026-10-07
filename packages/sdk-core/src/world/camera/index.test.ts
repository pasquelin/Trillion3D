import test from 'node:test'
import assert from 'node:assert/strict'
import { camera } from './index.ts'
import { near } from '../../math/near.fixture.ts'
import { Vector3 } from '../math/vector3.ts'

// The cube map face table a WebGPU cube texture is sampled by: per major axis, the axes texture s
// and t run along. A face drawn into a y-up image has s to its right and t up.
const FACES: [number[], number[], number[]][] = [
  [
    [1, 0, 0],
    [0, 0, -1],
    [0, -1, 0],
  ],
  [
    [-1, 0, 0],
    [0, 0, 1],
    [0, -1, 0],
  ],
  [
    [0, 1, 0],
    [1, 0, 0],
    [0, 0, 1],
  ],
  [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, -1],
  ],
  [
    [0, 0, 1],
    [1, 0, 0],
    [0, -1, 0],
  ],
  [
    [0, 0, -1],
    [-1, 0, 0],
    [0, -1, 0],
  ],
]

test('a cube rig lays its six eyes out as the cube map faces, and sees as they do', () => {
  const rig = camera.cube({ near: 2, far: 50 })
  rig.children.forEach((face, i) => {
    const eye = face as ReturnType<typeof camera.perspective>
    const [axis, s, t] = FACES[i]
    const centre = eye.rayThrough(0, 0, 1).direction.toArray()
    near(centre, axis, `face ${i}`, 1e-9)
    const off = (x: number, y: number) =>
      eye
        .rayThrough(x, y, 1)
        .direction.toArray()
        .map((v, k) => v * Math.SQRT2 - centre[k])
    near(off(1, 0), s, `face ${i} right`, 1e-9)
    near(off(0, 1), t, `face ${i} up`, 1e-9)
    assert.deepEqual(eye.projectionMatrix.elements, rig.projectionMatrix.elements)
    assert.equal(eye.projection, rig.projection)
    // A quarter turn either way of the axis; the near plane at depth 1, reversed: near / distance.
    near(
      new Vector3(2, 2, -2).applyMatrix4(eye.projectionMatrix).toArray(),
      [1, 1, 1],
      'near corner',
    )
    near(new Vector3(0, 0, -50).applyMatrix4(eye.projectionMatrix).toArray(), [0, 0, 0.04], 'far')
  })
})

test('stereo and array eyes are perspective cameras like any other', () => {
  const kind = camera.perspective().projection
  const { left, right } = camera.stereo()
  for (const eye of [left, right, camera.array([left, right])]) assert.equal(eye.projection, kind)
})

test('stereo eyes look the same way from points their separation apart, held by an array', () => {
  const { left, right, eyeSep } = camera.stereo()
  const eyes = camera.array([left, right])
  eyes.position.set(10, 20, 30)
  const l = left.rayThrough(0, 0, 1),
    r = right.rayThrough(0, 0, 1)
  near(l.origin.toArray(), [10 - eyeSep / 2, 20, 30], 'left', 1e-10)
  near(r.origin.toArray(), [10 + eyeSep / 2, 20, 30], 'right', 1e-10)
  near(l.direction.toArray(), r.direction.toArray(), 'parallel', 1e-10)
  assert.equal(left.parent, eyes)
  assert.equal(right.parent, eyes)
})
