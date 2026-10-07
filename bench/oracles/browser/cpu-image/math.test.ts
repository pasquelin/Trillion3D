// The oracle's barycentric weights: nominal and edge behaviours.
import test from 'node:test'
import assert from 'node:assert/strict'
import { signedArea } from './projection.ts'
import { barycentricAt } from './math.ts'

test('barycentricAt returns weights that sum to one and reconstruct the point at the centre', () => {
  const a = { x: 0, y: 0 },
    b = { x: 4, y: 0 },
    c = { x: 0, y: 4 }
  const area = signedArea(a, b, c)
  const centre = barycentricAt(a, b, c, (a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, area)
  assert.ok(Math.abs(centre.w0 - 1 / 3) < 1e-12)
  assert.ok(Math.abs(centre.w1 - 1 / 3) < 1e-12)
  assert.ok(Math.abs(centre.w2 - 1 / 3) < 1e-12)
  assert.ok(Math.abs(centre.w0 + centre.w1 + centre.w2 - 1) < 1e-12)
})

test('barycentricAt on a null-area triangle returns NaN or Infinity, never an exception', () => {
  const a = { x: 0, y: 0 },
    b = { x: 1, y: 1 },
    c = { x: 2, y: 2 }
  const weights = barycentricAt(a, b, c, 0.5, 0.5, signedArea(a, b, c))
  assert.ok(!Number.isFinite(weights.w0))
})

test('barycentricAt reuses the same work object from one call to the next (documented contract)', () => {
  const a = { x: 0, y: 0 },
    b = { x: 2, y: 0 },
    c = { x: 0, y: 2 }
  const area = signedArea(a, b, c)
  const first = barycentricAt(a, b, c, 0.5, 0.5, area)
  const second = barycentricAt(a, b, c, 1, 1, area)
  assert.equal(first, second)
})
