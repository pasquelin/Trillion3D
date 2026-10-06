import test from 'node:test'
import assert from 'node:assert/strict'
import { closestBetweenSegments } from './segmentPair.ts'
import { onSegment as within } from './segment.fixture.ts'

// The closed form against a dense sampling of both segments: the true distance is never above the
// nearest sampled pair, nor further below it than the sampling step; the pair lies on the segments.

const STEPS = 400
const onSegment = (p: ArrayLike<number>, s: number[]) => within(p, s, 1e-12, 1e-18)
const at = (s: number[], t: number) => [0, 1, 2].map((k) => s[k] + t * (s[3 + k] - s[k]))

function sampled(first: number[], second: number[]) {
  let best = Infinity
  for (let i = 0; i <= STEPS; i++)
    for (let j = 0; j <= STEPS; j++) {
      const [p, q] = [at(first, i / STEPS), at(second, j / STEPS)]
      best = Math.min(best, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2)
    }
  return Math.sqrt(best)
}

test('two segments: the distance and the pair of their nearest points, degenerate ones included', () => {
  const cases: [string, number[], number[]][] = [
    ['two points', [1, 2, 3, 1, 2, 3], [4, 6, 3, 4, 6, 3]],
    ['a point and a segment, inside', [1, 1, 0, 1, 1, 0], [0, 0, 0, 2, 0, 0]],
    ['a point and a segment, past its end', [3, 1, 0, 3, 1, 0], [0, 0, 0, 2, 0, 0]],
    ['a segment and a point, before its start', [0, 0, 0, 2, 0, 0], [-1, 1, 0, -1, 1, 0]],
    ['a segment and a point, inside', [0, 0, 0, 2, 0, 0], [1.5, 1, 0, 1.5, 1, 0]],
    ['parallel, overlapping', [0, 0, 0, 2, 0, 0], [1, 1, 0, 3, 1, 0]],
    ['parallel, apart', [0, 0, 0, 2, 0, 0], [3, 1, 0, 5, 1, 0]],
    ['skew, crossing', [0, 0, 0, 2, 0, 0], [1, -1, 1, 1, 1, 1]],
    ['second clamped at its start', [0, 0, 0, 2, 0, 0], [1, 1, 0, 1, 3, 0]],
    ['second clamped at its end', [0, 0, 0, 2, 0, 0], [1, 3, 0, 1, 1, 0]],
    ['first clamped, second at its start', [0, 0, 0, 2, 0, 0], [3, 1, 0, 5, 3, 0]],
    ['first clamped, second at its end', [0, 0, 0, 2, 0, 0], [5, 3, 0, 3, 1, 0]],
    ['first clamped before its start', [0, 0, 0, 2, 0, 0], [-1, 1, 0, -3, 3, 0]],
  ]
  const out = new Float64Array(6)
  for (const [label, first, second] of cases) {
    const distance = Math.sqrt(closestBetweenSegments(out, first, second))
    const expected = sampled(first, second)
    assert.ok(distance <= expected + 1e-12, `${label}: ${distance} above ${expected}`)
    assert.ok(distance >= expected - 0.02, `${label}: ${distance} below ${expected}`)
    assert.ok(onSegment(out.subarray(0, 3), first), `${label}: first point off its segment`)
    assert.ok(onSegment(out.subarray(3, 6), second), `${label}: second point off its segment`)
    const gap = Math.hypot(out[0] - out[3], out[1] - out[4], out[2] - out[5])
    assert.ok(Math.abs(gap - distance) < 1e-12, `${label}: the pair is at the distance`)
  }
})

test('a clamped end is the end itself, not its start plus the whole difference', () => {
  // 10000.1 + 1·(0.7 − 10000.1) is 0.7000000000007276; the start plus
  // the whole difference reads 2.0000000000014553.
  const out = new Float64Array(6)
  const squared = closestBetweenSegments(out, [10000.1, 0, 0, 0.7, 0, 0], [-0.3, 1, 0, -0.3, 3, 0])
  assert.deepEqual([...out], [0.7, 0, 0, -0.3, 1, 0])
  assert.equal(squared, 2)
})
