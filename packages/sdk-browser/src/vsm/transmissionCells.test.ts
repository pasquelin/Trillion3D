// The bin's cells (`transmissionWgsl.ts`: `vsmTCellRange`, `vsmTCoversCell`): a point's cell lists
// every triangle the read finds it in, for small, large, thin triangles and corners far off the page.
import test from 'node:test'
import assert from 'node:assert/strict'
import { type Tri, CELL, CELLS, f32, geometry, random } from './transmissionSheets.fixture.ts'

test('a point’s cell lists every triangle it lies in: small, large, thin, corners far off the page', () => {
  const rnd = random(3)
  let checked = 0
  for (let k = 0; k < 3000; k++) {
    const size = 10 ** (rnd() * 3.5 - 0.5)
    const thin = rnd() < 0.3 ? 0.005 : 1
    const centre = [rnd() * 200 - 36, rnd() * 200 - 36]
    const angle = rnd() * 2 * Math.PI
    const u = [Math.cos(angle), Math.sin(angle)],
      v = [-u[1] * thin, u[0] * thin]
    const tri = [0, 1, 2].map(() => {
      const a = rnd() * 2 - 1,
        b = rnd() * 2 - 1
      return [
        centre[0] + size * (a * u[0] + b * v[0]),
        centre[1] + size * (a * u[1] + b * v[1]),
      ].map(f32)
    }) as Tri
    const [a, b, c] = tri
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (area === 0) continue
    const lo = [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1])]
    const hi = [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1])]
    const range = geometry.vsmTCellRange(lo, hi)
    for (let n = 0; n < 40; n++) {
      // A point of the triangle, or one of its edges' points.
      let w = [rnd(), rnd(), rnd()]
      if (n % 4 === 0) w = [rnd(), 0, 0]
      const s = w[0] + w[1] + w[2] || 1
      w = w.map((x) => x / s)
      const p = [0, 1].map((ax) => f32(w[0] * a[ax] + w[1] * b[ax] + w[2] * c[ax]))
      if (p.some((x) => x < 0 || x >= 128)) continue
      if (!geometry.vsmTInside(a, b, c, p)) continue
      const cell = p.map((x) => Math.min(Math.floor(x / CELL), CELLS - 1))
      assert.ok(
        cell[0] >= range[0] && cell[0] <= range[2] && cell[1] >= range[1] && cell[1] <= range[3],
      )
      assert.ok(geometry.vsmTCoversCell(a, b, c, Math.sign(area), cell), `${tri} at ${p}`)
      checked++
    }
  }
  assert.ok(checked > 5000, `${checked}`)
})
