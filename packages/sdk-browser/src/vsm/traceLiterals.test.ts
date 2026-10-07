// The traces' decimal literals are the exact powers of two their comments derive them from: the
// f32 a shader compiles from each is that value, bit for bit, and the guard of the square-to-disk
// map leaves every quotient it can see as it is. The greatest f32 below 1 the traces and the
// casters' flattening share is 1 - 2^-24 too.
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionText } from '../bounce/wgslBody.fixture.ts'
import { VSM_F32_BELOW_ONE } from './constants.ts'
import { VSM_TRACE_COMMON_WGSL, vsmTraceWgsl } from './traceWgsl.ts'
import { vsmBlueNoiseTwo } from './blueNoise.ts'
import { vsmPoolLoadOf } from './resources.ts'
import { VSM_PROJECTION_VSM_SPECS } from './projectionWgsl.ts'
import { vsmLayout } from './layout.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'

const f32 = Math.fround
/** The projection's trace: its pool and its blue noise's pair. */
const TRACE = vsmTraceWgsl(
  true,
  vsmPoolLoadOf(
    0,
    VSM_PROJECTION_VSM_SPECS,
    vsmLayout({ fullMapCapacity: 127, sunMapCapacity: 35 }, 2 ** 27),
  ),
  vsmBlueNoiseTwo(1, 0),
)
/** The literal of `text` that `pattern` captures, as the f32 a shader makes of it. */
const literal = (text: string, pattern: RegExp) => {
  const found = pattern.exec(text)
  assert.ok(found, `${pattern} is in the text`)
  return f32(Number(found[1]))
}

test('the greatest f32 below 1 is 1 - 2^-24, read back from its decimal bit for bit', () => {
  assert.equal(f32(VSM_F32_BELOW_ONE), 1 - 2 ** -24)
})

test('the square-to-disk map reads 1 - 2^-24 and the smallest normal f32 as their decimals', () => {
  const map = functionText(wgslSource(VSM_TRACE_COMMON_WGSL), 'vsmSquareToDiskPolar')
  assert.equal(literal(map, /2\.0\*E-([0-9.e-]+);/), 1 - 2 ** -24)
  const guard = literal(
    wgslSource(VSM_TRACE_COMMON_WGSL),
    /const VSM_F32_MIN_NORMAL:f32=([0-9.e-]+);/,
  )
  assert.equal(guard, 2 ** -126)
  // A nonzero |p| = |2E - (1 - 2^-24)| of an f32 E in [0, 1) is 2^-25 at least: the guard added
  // to it rounds back to it, in every binade from there.
  const c = f32(1 - 2 ** -24)
  for (const e of [0.49999997, 0.5, 0.50000006, 0.4999999]) {
    const p = Math.abs(f32(f32(2 * f32(e)) - c))
    assert.ok(p === 0 || p >= 2 ** -25, `|p| = ${p}`)
  }
  for (let e = -25; e <= 1; e++)
    for (const p of [2 ** e, f32(2 ** e * 1.5), f32(2 ** (e + 1) * (1 - 2 ** -24))])
      assert.equal(f32(p + guard), p, `|p| = ${p}`)
})

test('the jitter step turns the top 24 bits into a fraction exactly: its factor is 2^-24', () => {
  const step = literal(TRACE.text, />>8u\)\*([0-9.e-]+);/)
  assert.equal(step, 2 ** -24)
  for (const k of [0, 1, 2 ** 23 + 1, 2 ** 24 - 1]) assert.equal(f32(f32(k) * step), k / 2 ** 24)
})
