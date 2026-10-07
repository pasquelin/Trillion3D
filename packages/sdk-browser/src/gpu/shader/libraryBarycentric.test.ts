// The barycentric declarations of the maths library (`packages/math/src/wgsl/barycentric.ts`),
// their shipped text run in JavaScript: each form's weights rebuild the point they weigh.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { lcg } from '../hiz/buildTranscripts.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import {
  affineBarycentric,
  edgeFunction,
  perspectiveBarycentric,
  planeBarycentric,
} from '../../../../math/src/wgsl/barycentric.ts'

type V = number[]
type F = (...args: unknown[]) => V
const run = shaderRun<Record<string, F>>(
  wgslModule(edgeFunction, affineBarycentric, perspectiveBarycentric, planeBarycentric),
  ['edgeFunction', 'affineBarycentric', 'perspectiveBarycentric', 'planeBarycentric'],
  {},
)
const edge = run.edgeFunction as unknown as (a: V, b: V, p: V) => number
const near = (a: V, b: V, what: string) =>
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= 1e-9, `${what}: ${a} vs ${b}`))
/** `n` draws of the seeded sequence, in [-1, 1). */
const take = (rand: () => number, n: number) => Array.from({ length: n }, () => 2 * rand() - 1)
const weigh = (w: V, corners: V[]) =>
  corners[0].map((_, k) => w[0] * corners[0][k] + w[1] * corners[1][k] + w[2] * corners[2][k])

test('the edge function is twice the signed area, positive to the left of a → b', () => {
  assert.equal(edge([0, 0], [1, 0], [0, 1]), 1)
  assert.equal(edge([0, 0], [1, 0], [0, -1]), -1)
  assert.equal(edge([0, 0], [2, 0], [5, 3]), 6)
  // Its three cyclic orders are one area.
  const [a, b, c] = [
    [0.3, -1.2],
    [2.5, 0.7],
    [-0.4, 1.9],
  ]
  assert.ok(Math.abs(edge(a, b, c) - edge(b, c, a)) < 1e-12)
  assert.ok(Math.abs(edge(a, b, c) - edge(c, a, b)) < 1e-12)
})

test('the affine weights sum to one and rebuild the screen point', () => {
  const g = lcg(13)
  for (let i = 0; i < 100; i++) {
    const corners = [take(g, 2), take(g, 2), take(g, 2)]
    const p = take(g, 2).map((x) => 2 * x)
    const area = edge(corners[0], corners[1], corners[2])
    const w = run.affineBarycentric(...corners, p, area)
    near([w[0] + w[1] + w[2]], [1], 'sum')
    near(weigh(w, corners), p, 'point')
  }
})

test('the perspective weights are those of the clip-space point the screen point shows', () => {
  const g = lcg(17)
  for (let i = 0; i < 100; i++) {
    const clip = [0, 1, 2].map(() => [...take(g, 3), 1.5 + (2 * g() - 1)])
    const screen = clip.map((c) => [c[0] / c[3], c[1] / c[3], c[2] / c[3]])
    const raw = take(g, 3).map((x) => x + 1.2)
    const truth = raw.map((x) => x / (raw[0] + raw[1] + raw[2]))
    const P = weigh(truth, clip)
    const p = [P[0] / P[3], P[1] / P[3]]
    const area = edge(screen[0], screen[1], screen[2])
    const iw = clip.map((c) => 1 / c[3])
    near(run.perspectiveBarycentric(...screen, iw, p, area), truth, `triangle ${i}`)
  }
  assert.deepEqual(
    run.perspectiveBarycentric([0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 1, 1], [0, 0], 0),
    [0.333, 0.333, 0.334],
  )
})

test('the plane weights rebuild the point projected on the triangle, all on a for a degenerate one', () => {
  const g = lcg(19)
  for (let i = 0; i < 100; i++) {
    const corners = [take(g, 3), take(g, 3), take(g, 3)]
    const truth = take(g, 2)
    const w = [1 - truth[0] - truth[1], truth[0], truth[1]]
    const [a, b, c] = corners
    const e0 = b.map((x, k) => x - a[k]),
      e1 = c.map((x, k) => x - a[k])
    const n = [
      e0[1] * e1[2] - e0[2] * e1[1],
      e0[2] * e1[0] - e0[0] * e1[2],
      e0[0] * e1[1] - e0[1] * e1[0],
    ]
    // Off the plane along its normal: the weights are the projection's.
    const q = weigh(w, corners).map((x, k) => x + 0.7 * n[k])
    near(run.planeBarycentric(q, ...corners), w, `triangle ${i}`)
  }
  assert.deepEqual(run.planeBarycentric([1, 2, 3], [0, 0, 0], [1, 1, 1], [2, 2, 2]), [1, 0, 0])
})
