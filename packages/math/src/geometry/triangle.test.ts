// triangle.ts triangleCross and triangleArea: against exact integer cross products, Heron's area,
// and the forms the sites write, bit for bit.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { triangleArea, triangleCross } from './triangle.ts'
import { length3 } from '../vector/vector.ts'
import { haltonSpan } from '../sequence/sweep.fixture.ts'

test('the cross product of integer corners is exact; its winding gives its sign', () => {
  const v = [1, 1, 1, 4, 1, 1, 1, 5, 1]
  // Edges (3, 0, 0) and (0, 4, 0): the cross (0, 0, 12), the area 6.
  assert.deepEqual(triangleCross([0, 0, 0], 0, v, 0, 3, 6), [0, 0, 12])
  assert.deepEqual(triangleCross([0, 0, 0], 0, v, 0, 6, 3), [0, 0, -12])
  assert.equal(triangleArea(v, 0, 3, 6), 6)
  const out = [7, 7, 7, 7, 7]
  triangleCross(out, 2, [0, 0, 0, 0, 0, 0, 2, 2, 2], 0, 3, 6)
  assert.deepEqual(out, [7, 7, 0, 0, 0])
})

test('the area is Heron’s on scattered triangles', () => {
  for (let k = 0; k < 2000; k++) {
    const v = Array.from({ length: 9 }, (_, i) =>
      haltonSpan(k * 9 + i + 1, [2, 3, 5][i % 3], -10, 10),
    )
    const side = (p: number, q: number) =>
      length3(v[q] - v[p], v[q + 1] - v[p + 1], v[q + 2] - v[p + 2])
    const [a, b, c] = [side(0, 3), side(3, 6), side(6, 0)].sort((x, y) => y - x)
    // Heron in Kahan's stable order, sides from the longest.
    const heron = Math.sqrt((a + (b + c)) * (c - (a - b)) * (c + (a - b)) * (a + (b - c))) / 4
    assert.ok(Math.abs(triangleArea(v, 0, 3, 6) - heron) <= 1e-9 * (1 + heron), `${k}`)
  }
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
    const area = length3(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2
    assert.ok(Object.is(triangleArea(v, 1 * 3, 2 * 3, 3 * 3), area), `${k}`)
  }
})
