import test from 'node:test'
import assert from 'node:assert/strict'
import { closestSegmentTriangle } from './closest.ts'
import { onSegment } from './segment.fixture.ts'

// The closed forms against a dense sampling of the segment and the triangle: the true distance is
// never above the nearest sampled pair, and never further below it than the sampling step.

const STEPS = 48

function sampledDistance(segment: number[], v: number[]) {
  let best = Infinity
  for (let i = 0; i <= STEPS; i++) {
    const s = i / STEPS
    const p = [0, 1, 2].map((k) => segment[k] + s * (segment[3 + k] - segment[k]))
    for (let a = 0; a <= STEPS; a++)
      for (let b = 0; a + b <= STEPS; b++) {
        const [u, w] = [a / STEPS, b / STEPS]
        let d = 0
        for (let k = 0; k < 3; k++) {
          const q = v[k] + u * (v[3 + k] - v[k]) + w * (v[6 + k] - v[k])
          d += (p[k] - q) ** 2
        }
        best = Math.min(best, d)
      }
  }
  return Math.sqrt(best)
}

/** Whether `p` lies on triangle `v`: in its plane, barycentric weights in `[0, 1]`, within `eps`. */
function onTriangle(p: ArrayLike<number>, v: number[], eps = 1e-9) {
  const u = [0, 1, 2].map((k) => v[3 + k] - v[k]),
    w = [0, 1, 2].map((k) => v[6 + k] - v[k]),
    r = [0, 1, 2].map((k) => p[k] - v[k])
  const dot = (x: number[], y: number[]) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2]
  const [uu, uw, ww, ru, rw] = [dot(u, u), dot(u, w), dot(w, w), dot(r, u), dot(r, w)]
  const det = uu * ww - uw * uw
  if (det === 0) return true
  const a = (ru * ww - rw * uw) / det,
    b = (rw * uu - ru * uw) / det
  const off = [0, 1, 2].map((k) => r[k] - a * u[k] - b * w[k])
  return a >= -eps && b >= -eps && a + b <= 1 + eps && dot(off, off) <= eps
}

function check(segment: number[], v: number[], label: string) {
  const out = new Float64Array(6)
  const squared = closestSegmentTriangle(out, segment, v, 0)
  const distance = Math.sqrt(squared)
  const sampled = sampledDistance(segment, v)
  const size = Math.max(...[...segment, ...v].map(Math.abs), 1)
  assert.ok(distance <= sampled + 1e-9, `${label}: ${distance} above sampled ${sampled}`)
  assert.ok(distance >= sampled - (3 * size) / STEPS, `${label}: ${distance} below ${sampled}`)
  assert.ok(onSegment(out.subarray(0, 3), segment), `${label}: first point off the segment`)
  if (distance > 0) assert.ok(onTriangle(out.subarray(3, 6), v), `${label}: point off triangle`)
  const gap = [0, 1, 2].reduce((sum, k) => sum + (out[k] - out[3 + k]) ** 2, 0)
  assert.ok(Math.abs(gap - squared) <= 1e-9 * Math.max(1, squared), `${label}: pair and distance`)
}

const TRIANGLE = [0, 0, 0, 2, 0, 0, 0, 2, 0]

test('a segment and a triangle: the pair and the distance of the nearest points, on every case', () => {
  const cases: [string, number[], number[]][] = [
    ['pierces', [0.5, 0.5, -1, 0.5, 0.5, 1], TRIANGLE],
    ['above the face', [0.3, 0.4, 1, 0.6, 0.2, 2], TRIANGLE],
    ['below the face', [0.3, 0.4, -2, 0.6, 0.2, -1], TRIANGLE],
    ['end on the plane', [0.5, 0.5, 0, 0.5, 0.5, 1], TRIANGLE],
    ['crosses the plane outside', [3, 3, -1, 3, 3, 1], TRIANGLE],
    ['beside an edge', [-1, -1, 0.5, -1, 3, 0.5], TRIANGLE],
    ['across the hypotenuse', [2, 2, -0.5, 2, 2, 0.5], TRIANGLE],
    ['skew over an edge', [1, -1, 1, 1, 1, -1], [0, 0, 0, 2, 0, 0, 0, 0, 2]],
    ['in the plane, outside', [3, 0, 0, 3, 1, 0], TRIANGLE],
    ['parallel to an edge', [0, -1, 0, 2, -1, 0], TRIANGLE],
    ['past the edge end', [3, -1, 0, 5, -1, 0], TRIANGLE],
    ['before the edge start', [-4, -1, 0, -2, -1, 0], TRIANGLE],
    ['a point above', [0.5, 0.5, 1, 0.5, 0.5, 1], TRIANGLE],
    ['a point off a corner', [-1, -1, 1, -1, -1, 1], TRIANGLE],
    ['clockwise triangle', [0.5, 0.5, 1, 0.5, 0.5, 2], [0, 0, 0, 0, 2, 0, 2, 0, 0]],
    ['degenerate triangle', [1, 1, 1, 1, 2, 1], [0, 0, 0, 1, 0, 0, 2, 0, 0]],
    ['point triangle', [1, 1, 1, 2, 1, 1], [1, 0, 0, 1, 0, 0, 1, 0, 0]],
    ['segment on a vertex', [2, 0, 0, 2, 0, 1], TRIANGLE],
  ]
  for (const [label, segment, v] of cases) check(segment, v, label)
  let seed = 3
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32) * 4 - 2
  for (let trial = 0; trial < 60; trial++) {
    const v = Array.from({ length: 9 }, rand)
    check(Array.from({ length: 6 }, rand), v, `random ${trial}`)
  }
})

test('a piercing segment reports the crossing on both halves, at distance zero', () => {
  const out = new Float64Array(6)
  assert.equal(closestSegmentTriangle(out, [0.5, 0.25, -1, 0.5, 0.25, 3], TRIANGLE, 0), 0)
  assert.deepEqual([...out], [0.5, 0.25, 0, 0.5, 0.25, 0])
})

test('a triangle read at an offset of a flat list', () => {
  const out = new Float64Array(6)
  const list = [9, 9, 9, ...TRIANGLE]
  assert.equal(closestSegmentTriangle(out, [0.5, 0.5, 2, 0.5, 0.5, 3], list, 3), 4)
  assert.deepEqual([...out], [0.5, 0.5, 2, 0.5, 0.5, 0])
})
