// The decimal literals of the square-to-disk map of a sun's rays are the exact powers of two their comments
// derive them from: the f32 a shader compiles from each is that value, bit for bit, and the guard of the map
// leaves every quotient it can see as it is.
import test from 'node:test'
import assert from 'node:assert/strict'
import { uniformDiskConcentric } from '../../../../../../math/src/wgsl/sampling.ts'
import { wgslSource } from '../../../../../../math/src/wgsl/source.fixture.ts'

/** The literal of `text` that `pattern` captures, as the f32 a shader makes of it. */
const literal = (text: string, pattern: RegExp) => {
  const found = pattern.exec(text)
  assert.ok(found, `${pattern} is in the text`)
  return Math.fround(Number(found[1]))
}

test('the square-to-disk map reads 1 - 2^-24 and its guard as their decimals', () => {
  const map = wgslSource(uniformDiskConcentric)
  // The greatest f32 below 1, the square's centre.
  assert.equal(literal(map, /2\.0\*e-([0-9.e-]+);/), 1 - 2 ** -24)
  const guard = literal(map, /hi\+([0-9.e-]+)\)/)
  assert.equal(guard, 2 ** -64)
  // A nonzero |p| = |2E - (1 - 2^-24)| of an f32 E in [0, 1) is 2^-25 at least: the guard added
  // to it rounds back to it, in every binade from there.
  const c = Math.fround(1 - 2 ** -24)
  for (const e of [0.49999997, 0.5, 0.50000006, 0.4999999]) {
    const p = Math.abs(Math.fround(Math.fround(2 * Math.fround(e)) - c))
    assert.ok(p === 0 || p >= 2 ** -25, `|p| = ${p}`)
  }
  for (let e = -25; e <= 1; e++)
    for (const p of [2 ** e, Math.fround(2 ** e * 1.5), Math.fround(2 ** (e + 1) * (1 - 2 ** -24))])
      assert.equal(Math.fround(p + guard), p, `|p| = ${p}`)
})
