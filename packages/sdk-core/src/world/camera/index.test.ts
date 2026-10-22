import test from 'node:test'
import assert from 'node:assert/strict'
import { camera } from './index.ts'
import { near } from '../../../../math/src/float/near.fixture.ts'
import { Vector3 } from '../math/vector3.ts'
import { Object3D } from '../object/object3d.ts'
import { NO_VIEW_SET } from './viewSet.ts'

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

test('a view carries no plane and no list until its camera is given them', () => {
  const eye = camera.perspective()
  assert.equal(eye.clipPlane, null)
  assert.deepEqual(eye.hidden, [])
  assert.equal(eye.showOnly, null)
  assert.equal(eye._viewSet, NO_VIEW_SET, 'every camera that has none shares one set')
})

test('a clip plane is the point it passes through and the unit normal of the side drawn', () => {
  const eye = camera.perspective()
  eye.clipPlane = { base: [0, 3, 0], normal: [0, 5, 0] }
  assert.deepEqual(eye._viewSet.clipPlane, [0, 1, 0, 3], 'n · p - w >= 0 is drawn, w = n · base')
  assert.deepEqual(eye.clipPlane, { base: [0, 3, 0], normal: [0, 1, 0] })
  // Each part left out is at its default: the origin, up (the engine's, +y).
  eye.clipPlane = {}
  assert.deepEqual(eye._viewSet.clipPlane, [0, 1, 0, 0])
  eye.clipPlane = { base: { x: 1, y: 2, z: 4 }, normal: { x: 0, y: 0, z: -2 } }
  assert.deepEqual(eye._viewSet.clipPlane, [0, 0, -1, -4])
  // A zero normal, null and false name none.
  for (const none of [{ normal: [0, 0, 0] as const }, null, false as unknown as null]) {
    eye.clipPlane = none
    assert.equal(eye.clipPlane, null)
    assert.deepEqual(eye._viewSet.clipPlane, [0, 0, 0, 0])
  }
  // A normal too small for its square to be held is still a direction.
  eye.clipPlane = { normal: [0, 1e-200, 0] }
  assert.deepEqual(eye._viewSet.clipPlane, [0, 1, 0, 0])
  for (const bad of [true, 3, { base: [0, 0] }, { normal: [0, 0, NaN] }, { base: 'a' }])
    assert.throws(() => (eye.clipPlane = bad as never), /clipPlane: /)
})

test('a view that has a plane is drawn without temporal jitter, the set saying so where it is made', () => {
  const eye = camera.perspective()
  assert.equal(eye._viewSet.jitters, true)
  eye.clipPlane = { base: [0, 3, 0] }
  assert.equal(eye._viewSet.jitters, false)
  eye.hidden = []
  assert.equal(eye._viewSet.jitters, false, 'a list written leaves it as the plane says')
  eye.clipPlane = null
  assert.equal(eye._viewSet.jitters, true)
  assert.equal(eye._viewSet.hidden.length, 0)
})

test('the lists are copies, hidden empty and showOnly null by default, an empty showOnly drawing nothing', () => {
  const a = new Object3D(),
    b = new Object3D(),
    eye = camera.perspective()
  const mine = [a]
  eye.hidden = mine
  mine.push(b)
  assert.deepEqual(eye.hidden, [a], 'the page’s own array is not held')
  assert.ok(Object.isFrozen(eye.hidden))
  eye.showOnly = new Set([b])
  assert.deepEqual(eye.showOnly, [b])
  eye.showOnly = []
  assert.deepEqual(eye.showOnly, [], 'a list, though empty: no object is drawn')
  eye.showOnly = null
  assert.equal(eye.showOnly, null)
  for (const bad of [5, { a }, [a, 3], [null]])
    assert.throws(() => (eye.hidden = bad as never), /hidden: /)
})

test('each write is a new set, so a view that was drawn can tell it was written; a clone keeps them', () => {
  const eye = camera.perspective(),
    node = new Object3D()
  const before = eye._viewSet
  eye.hidden = [node]
  const hidden = eye._viewSet
  assert.notEqual(hidden, before)
  eye.clipPlane = { normal: [1, 0, 0] }
  assert.notEqual(eye._viewSet, hidden)
  assert.deepEqual(eye._viewSet.hidden, [node], 'one field written, the others kept')
  const copy = eye.clone()
  assert.deepEqual(copy.clipPlane, eye.clipPlane)
  assert.deepEqual(copy.hidden, [node])
})
