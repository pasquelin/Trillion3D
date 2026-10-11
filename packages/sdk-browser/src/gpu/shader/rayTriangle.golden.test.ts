// The shader's ray–triangle hit (`rayTriangleDistance`, `packages/math/src/wgsl/geometry.ts`), its
// shipped text run in JavaScript, against the Rust twin's distances in
// `packages/math/golden/ray_triangle.json`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { rayTriangleDistance } from '../../../../math/src/wgsl/geometry.ts'
import { eachGolden } from '../../../../math/src/golden.fixture.ts'

const run = shaderRun<Record<string, (...args: never[]) => never>>(
  wgslModule(rayTriangleDistance),
  ['rayTriangleDistance'],
  {},
) as unknown as Record<string, (...args: unknown[]) => number>

test('the shader’s ray–triangle hit is the Rust twin’s, on the cases it can state', () => {
  let hits = 0,
    misses = 0
  eachGolden('ray_triangle', 'ray_triangle', (v, out, line) => {
    // The shader's range opens at 1e-4, and a NaN or an infinity has no stated outcome on a GPU.
    if (v[15] !== 1e-4 || !v.every(Number.isFinite)) return
    const limit = v[16]
    const got = run.rayTriangleDistance(
      v.slice(0, 3),
      v.slice(3, 6),
      v.slice(6, 9),
      v.slice(9, 12),
      v.slice(12, 15),
      limit,
    )
    if (out.length) {
      assert.ok(Math.abs(got - out[0]) <= 1e-9 * Math.max(1, Math.abs(out[0])), line)
      hits++
    } else {
      assert.equal(got, limit, line)
      misses++
    }
  })
  assert.ok(hits > 20 && misses > 20, `${hits} hits, ${misses} misses`)
})
