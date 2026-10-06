// Batch M2, box.ts: empty and inverted box, union, expansion, matrix transformation — each
// function tested against the host library's box arithmetic, bitwise (Object.is).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  boxCornersInto,
  boxEmpty,
  boxExpandByPoint,
  boxIsEmpty,
  boxTransform,
  boxUnion,
} from '../../../../../../../packages/sdk-core/src/index.ts'
import { assertBits } from '../../../../../../../tests/kit/assert/bits.ts'
import { aPlat, box3 } from '../../../../../../oracles/core/volumes.ts'
import { boxTransformBefore, hostileFloats } from '../../../../../../oracles/core/hot-path-math.ts'

test('boxEmpty sets inverted bounds at infinity', () => {
  const out = new Float64Array(6)
  boxEmpty(out, 0)
  assertBits(out, aPlat(new THREE.Box3().makeEmpty()))
})

test('boxIsEmpty reports an inverted box, not a point box nor a NaN bound', () => {
  assert.equal(boxIsEmpty([1, 1, 1, 0, 0, 0], 0), true) // inverted
  assert.equal(boxIsEmpty([2, 3, 4, 2, 3, 4], 0), false) // point: equal bounds
  assert.equal(boxIsEmpty([NaN, 0, 0, 1, 1, 1], 0), false) // a NaN bound does not empty the box
  assert.equal(boxIsEmpty([0, 0, 0, 1, NaN, 1], 0), false)
})

test('boxUnion matches the host-library union, including empty box, signed zero, and infinities', () => {
  const cas: [number[], number[]][] = [
    [
      [-1, -1, -1, 1, 1, 1],
      [2, 2, 2, 3, 3, 3],
    ],
    [
      [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity],
      [0, 0, 0, 1, 1, 1],
    ],
    [
      [-0, -0, -0, 0, 0, 0],
      [0, 0, 0, -0, -0, -0],
    ],
    [
      [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity],
      [1, 2, 3, 4, 5, 6],
    ],
  ]
  for (const [a, b] of cas) {
    const expected = aPlat(box3(a).union(box3(b)))
    const actual = Float64Array.from(a)
    boxUnion(actual, 0, b[0], b[1], b[2], b[3], b[4], b[5])
    assertBits(actual, expected)
  }
})

test('boxExpandByPoint matches the host-library expansion by a point, including NaN and infinite points', () => {
  const cas: [number[], number[]][] = [
    [
      [-1, -1, -1, 1, 1, 1],
      [5, -5, 0],
    ],
    [
      [0, 0, 0, 0, 0, 0],
      [Infinity, -Infinity, NaN],
    ],
    [
      [1, 1, 1, 0, 0, 0],
      [0.5, 0.5, 0.5],
    ], // input inverted box
  ]
  for (const [a, p] of cas) {
    const expected = aPlat(box3(a).expandByPoint(new THREE.Vector3(p[0], p[1], p[2])))
    const actual = Float64Array.from(a)
    boxExpandByPoint(actual, 0, p[0], p[1], p[2])
    assertBits(actual, expected)
  }
})

test('boxTransform matches the host-library transformed box under negative scale on a single axis', () => {
  const m = new THREE.Matrix4().makeScale(-2, 1, 1).setPosition(3, -1, 2)
  const b = [-1, -2, -3, 4, 5, 6]
  const expected = aPlat(box3(b).applyMatrix4(m))
  const actual = new Float64Array(6)
  boxTransform(actual, 0, b, 0, m.elements)
  assertBits(actual, expected)
})

test('boxTransform matches the host-library transformed box under non-uniform scale and parent rotation', () => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -1.1, 2.3))
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(1, 2, -3),
    q,
    new THREE.Vector3(0.2, 5, -1.5),
  )
  const b = [-2, -1, -4, 3, 2, 1]
  const expected = aPlat(box3(b).applyMatrix4(m))
  const actual = new Float64Array(6)
  boxTransform(actual, 0, b, 0, m.elements)
  assertBits(actual, expected)
})

test('boxTransform matches the host-library transformed box under zero scale on an axis', () => {
  const m = new THREE.Matrix4().makeScale(1, 0, 1)
  const b = [-1, -1, -1, 1, 1, 1]
  const expected = aPlat(box3(b).applyMatrix4(m))
  const actual = new Float64Array(6)
  boxTransform(actual, 0, b, 0, m.elements)
  assertBits(actual, expected)
})

test('boxTransform matches the host-library transformed box under NaN, infinite, or zero matrix', () => {
  const cas = [new Array(16).fill(NaN), new Array(16).fill(Infinity), new Array(16).fill(0)]
  const b = [-1, -1, -1, 1, 1, 1]
  for (const m of cas) {
    const expected = aPlat(box3(b).applyMatrix4(new THREE.Matrix4().fromArray(m)))
    const actual = new Float64Array(6)
    boxTransform(actual, 0, b, 0, m)
    assertBits(actual, expected)
  }
})

test('boxTransform in place (out === box) yields same result as a fresh output', () => {
  const m = new THREE.Matrix4().makeScale(2, -3, 0.5).setPosition(1, 1, 1)
  const b = [-1, -2, -3, 4, 5, 6]
  const frais = new Float64Array(6)
  boxTransform(frais, 0, b, 0, m.elements)
  const surPlace = Float64Array.from(b)
  boxTransform(surPlace, 0, surPlace, 0, m.elements)
  assertBits(surPlace, frais)
})

test('boxTransform keeps an empty box unchanged, bounds included', () => {
  const blank = new Float64Array(6)
  boxEmpty(blank, 0)
  const before = Float64Array.from(blank)
  boxTransform(blank, 0, blank, 0, new THREE.Matrix4().makeScale(2, 2, 2).elements)
  assertBits(blank, before)
})

test('boxCornersInto matches the host-library matrix applied to each corner', () => {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(2, -1, 0.5),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.7, 0.2, -1.9)),
    new THREE.Vector3(-1.5, 3, 2),
  )
  const b = [-2, -3, -4, 1, 2, 3]
  const expected = new Float64Array(24)
  for (let i = 0; i < 8; i++) {
    const coin = new THREE.Vector3(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2])
    coin.applyMatrix4(m).toArray(expected, i * 3)
  }
  const actual = new Float64Array(24)
  boxCornersInto(actual, 0, b[0], b[1], b[2], b[3], b[4], b[5], m.elements)
  assertBits(actual, expected)
})

test('boxTransform folds the corners boxCornersInto writes, bit for bit, on 200 000 hostile cases', () => {
  const f = hostileFloats(9171)
  const out = new Float64Array(6)
  for (let i = 0; i < 200_000; i++) {
    const m = Array.from({ length: 16 }, (_, k) => (i % 2 && k % 4 === 3 ? +(k === 15) : f()))
    const lo = [f(), f(), f()]
    const box = [...lo, ...lo.map((v) => v + Math.abs(f()))]
    boxTransform(out, 0, box, 0, m)
    const before = boxTransformBefore(box, m)
    if (!before.every((v, k) => Object.is(v, out[k]))) assert.fail(`box ${box}, matrix ${m}`)
  }
})
