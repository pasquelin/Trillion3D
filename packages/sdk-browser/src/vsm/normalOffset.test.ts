// The normal bias length has one rule (`vsmNormalOffsetLength`, `constants.ts`), read by the
// projection (opaque shadows) and by the lighting that reads a shadow map (translucent casters,
// blended surfaces, water). The projection's call is the expression it held before, operation for
// operation, so its bits are as they were; the lighting's call, which held the tangent where the
// projection holds its inverse, now divides by the inverse of the tangent: the same length to within
// two units of the last place of an f32 (the run here is in doubles, the tangent's inverse rounded
// to an f32 as the shader holds it), never more.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { VSM_CONSTANTS_WGSL, VSM_NORMAL_BIAS } from './constants.ts'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { halton } from '../../../math/src/sequence/halton.ts'

const source = wgslModule(VSM_CONSTANTS_WGSL)
const { vsmNormalOffsetLength } = shaderRun<{
  vsmNormalOffsetLength: (bias: number, distance: number, inverseTangent: number) => number
}>(source, ['vsmNormalOffsetLength'], {})
const floor = wgslConstants(VSM_CONSTANTS_WGSL).VSM_NORMAL_OFFSET_FLOOR
const f = Math.fround
const ulp = (x: number) => 2 ** (Math.floor(Math.log2(Math.abs(x))) - 23)

test('the projection’s length is its former expression, operation for operation', () => {
  for (let i = 1; i <= 2000; i++) {
    const distance = f(2 ** (halton(i, 2) * 20 - 6)),
      inverseTangent = f(0.2 + halton(i, 3) * 6)
    const former = Math.max(floor, (VSM_NORMAL_BIAS * distance) / inverseTangent)
    assert.equal(vsmNormalOffsetLength(VSM_NORMAL_BIAS, distance, inverseTangent), former)
  }
})

test('an orthographic view’s length is the bias times its distance along the view axis, the floor under it', () => {
  for (let i = 1; i <= 500; i++) {
    const distance = f(2 ** (halton(i, 2) * 20 - 6))
    const expected = Math.max(floor, VSM_NORMAL_BIAS * distance)
    assert.equal(vsmNormalOffsetLength(VSM_NORMAL_BIAS, distance, 1), expected)
  }
  assert.equal(vsmNormalOffsetLength(VSM_NORMAL_BIAS, 0, 1), floor)
})

test('the lighting’s length is its former product to within two units of the last place', () => {
  for (let i = 1; i <= 2000; i++) {
    const distance = f(2 ** (halton(i, 2) * 20 - 6)),
      tangent = f(0.05 + halton(i, 3) * 4)
    const former = Math.max(floor, VSM_NORMAL_BIAS * distance * tangent)
    const now = vsmNormalOffsetLength(VSM_NORMAL_BIAS, distance, f(1 / tangent))
    if (former > floor) assert.ok(Math.abs(now - former) <= 2 * ulp(former), `${now} for ${former}`)
  }
})
