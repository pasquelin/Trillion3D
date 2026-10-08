// `boxNormal` walks the six faces of a box instead of listing them — six arrays of four
// numbers, a closure and a vector, to pick the narrowest of six gaps. The face it names must be the
// same one on every face, so this casts at each face of three boxes and compares against the
// list-and-reduce form it replaces, evaluated at the point the ray enters the box.
import test from 'node:test'
import assert from 'node:assert/strict'
import { raycast } from './index.ts'
import { Ray } from '../math/volumes.ts'
import { Vector3 } from '../math/vector3.ts'
import { Box3 } from '../math/box3.ts'
import { Object3D } from './object3d.ts'
import { clamp } from '../../../../math/src/scalar/reals.ts'

/** A node whose own bounds are the box given: the ray hits it on a face, never on a triangle. */
class Shell extends Object3D {
  private readonly borne: Box3
  constructor(borne: Box3) {
    super()
    this.borne = borne
  }
  override localBounds() {
    return this.borne
  }
}

/** The face the walk must name, the way the list-and-reduce it replaces named it: the narrowest of
 *  the six gaps, the first of an equal pair. */
function expectedFace(box: Box3, at: Vector3) {
  const gaps = [
    [at.x - box.min.x, -1, 0, 0],
    [box.max.x - at.x, 1, 0, 0],
    [at.y - box.min.y, 0, -1, 0],
    [box.max.y - at.y, 0, 1, 0],
    [at.z - box.min.z, 0, 0, -1],
    [box.max.z - at.z, 0, 0, 1],
  ]
  const retenu = gaps.reduce((a, b) => (Math.abs(b[0]) < Math.abs(a[0]) ? b : a))
  return [retenu[1], retenu[2], retenu[3]]
}

/** Three numbers equal: a normal carried through a matrix may come back signed zero, which the list
 *  it replaces produced too, and which is not a difference of face. */
function memesNombres(found: number[], expected: number[], ou: string) {
  for (let i = 0; i < 3; i++) assert.equal(found[i], expected[i], `${ou}[${i}]`)
}

const SHELLS = [
  new Box3(new Vector3(2, 3, 4), new Vector3(6, 9, 12)),
  new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)),
  new Box3(new Vector3(0, 0, 0), new Vector3(2, 1, 5)),
]

test('every face of three boxes names the face the six gaps name', () => {
  let examines = 0
  for (const box of SHELLS)
    for (let axe = 0; axe < 3; axe++)
      for (const signe of [-1, 1]) {
        // The ray starts outside on one axis and crosses the face on it; the entry point is the
        // origin clamped into the box, and it is where the face is read from.
        const start = [0, 1, 2].map((k) => (box.min.elements[k] + box.max.elements[k]) / 2)
        const bord = signe < 0 ? box.min.elements[axe] : box.max.elements[axe]
        start[axe] = bord + signe * 3
        const direction = [0, 0, 0]
        direction[axe] = -signe
        const entree = start.map((v, k) => clamp(v, box.min.elements[k], box.max.elements[k]))
        const expected = expectedFace(box, new Vector3(...(entree as [number, number, number])))
        const [touch] = raycast(
          new Shell(box),
          new Ray(
            new Vector3(...(start as [number, number, number])),
            new Vector3(...(direction as [number, number, number])),
          ),
        )
        assert.ok(touch, `axis ${axe} sign ${signe}: the ray must meet the box`)
        assert.equal(touch.face, -1, 'a box, not a triangle')
        memesNombres(touch.normal.toArray(), expected, `axis ${axe} sign ${signe}`)
        examines++
      }
  assert.equal(examines, 18, 'three boxes, three axes, two signs')
})

test('a ray entering a corner names one of the three faces it meets, and it is the first', () => {
  // Where two faces are at the same distance from the entry point, the walk keeps the first of the
  // six, as the list-and-reduce it replaces did. A ray aimed at a corner reaches that case, and it
  // is the only one where a face's own axis matters.
  const box = new Box3(new Vector3(-2, -2, -2), new Vector3(2, 2, 2))
  const corners = [
    [-2, -2, -2],
    [-2, 2, 2],
    [2, -2, 2],
    [2, 2, -2],
  ]
  let examines = 0
  for (const coin of corners) {
    const launched = [coin[0] * 6, coin[1] * 6, coin[2] * 6]
    const towards = [coin[0] - coin[0] * 0.3, coin[1] - coin[1] * 0.3, coin[2] - coin[2] * 0.3]
    const direction = [towards[0] - launched[0], towards[1] - launched[1], towards[2] - launched[2]]
    const [touch] = raycast(
      new Shell(box),
      new Ray(
        new Vector3(...(launched as [number, number, number])),
        new Vector3(...(direction as [number, number, number])),
      ),
    )
    assert.ok(touch, `corner ${coin.join()}: the ray must meet the box`)
    // The entry point of a ray from `launched` towards `towards`, on the face the walk must read.
    const p = launched,
      d = direction
    let tMin = 0,
      tMax = Infinity
    for (let k = 0; k < 3; k++) {
      if (d[k] === 0) continue
      const t1 = (box.min.elements[k] - p[k]) / d[k],
        t2 = (box.max.elements[k] - p[k]) / d[k]
      tMin = Math.max(tMin, Math.min(t1, t2))
      tMax = Math.min(tMax, Math.max(t1, t2))
    }
    assert.ok(tMin < tMax, `corner ${coin.join()}: the ray must cross, not graze`)
    const entree = p.map((v, k) => v + d[k] * tMin)
    const expected = expectedFace(box, new Vector3(...(entree as [number, number, number])))
    memesNombres(touch.normal.toArray(), expected, `corner ${coin.join()}`)
    examines++
  }
  assert.equal(examines, 4, 'four corners of one box')
})

test('the distances a raycast answers do not depend on the copies it stopped making', () => {
  // The triangle path is handed the ray's origin and direction: they were copied into an array per
  // node, and are now the vector's own numbers. Two origins of one direction stay two distances.
  const box = new Shell(new Box3(new Vector3(0, 0, 0), new Vector3(1, 1, 1)))
  const near = raycast(box, new Ray(new Vector3(0.5, 0.5, -4), new Vector3(0, 0, 1)))[0]
  const loin = raycast(box, new Ray(new Vector3(0.5, 0.5, -40), new Vector3(0, 0, 1)))[0]
  assert.equal(near.distance, 4, 'the first origin is four units from the face')
  assert.equal(loin.distance, 40, 'and the second forty: the origin was read, not assumed')
  assert.deepEqual(near.normal.toArray(), [0, 0, -1], 'both name the face they crossed')
})
