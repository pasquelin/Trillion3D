// triangle.ts triangleCross: against exact integer cross products, and the forms the sites write,
// bit for bit.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { triangleCross } from './triangle.ts'
import { haltonSpan } from '../sequence/sweep.fixture.ts'

test('the cross product of integer corners is exact; its winding gives its sign', () => {
  const v = [1, 1, 1, 4, 1, 1, 1, 5, 1]
  // Edges (3, 0, 0) and (0, 4, 0): the cross (0, 0, 12), twice the area.
  assert.deepEqual(triangleCross([0, 0, 0], 0, v, 0, 3, 6), [0, 0, 12])
  assert.deepEqual(triangleCross([0, 0, 0], 0, v, 0, 6, 3), [0, 0, -12])
  const out = [7, 7, 7, 7, 7]
  triangleCross(out, 2, [0, 0, 0, 0, 0, 0, 2, 2, 2], 0, 3, 6)
  assert.deepEqual(out, [7, 7, 0, 0, 0])
})

test('the sites’ spellings: corners at v[at], v[at + 3], v[at + 6], and at 3·index', () => {
  const out = new Float64Array(3)
  for (let k = 0; k < 2000; k++) {
    const v = Array.from({ length: 12 }, (_, i) =>
      haltonSpan(k * 12 + i + 1, [2, 3, 5][i % 3], -50, 50),
    )
    const at = 3
    const ux = v[at + 3] - v[at],
      uy = v[at + 4] - v[at + 1],
      uz = v[at + 5] - v[at + 2]
    const wx = v[at + 6] - v[at],
      wy = v[at + 7] - v[at + 1],
      wz = v[at + 8] - v[at + 2]
    triangleCross(out, 0, v, at, at + 3, at + 6)
    assert.ok(Object.is(out[0], uy * wz - uz * wy), `${k}`)
    assert.ok(Object.is(out[1], uz * wx - ux * wz), `${k}`)
    assert.ok(Object.is(out[2], ux * wy - uy * wx), `${k}`)
  }
})
