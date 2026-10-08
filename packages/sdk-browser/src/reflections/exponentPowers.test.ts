// The powers of two of an integer exponent the shaders built by `exp2` or by a shift now read
// `pow2FromExponent` (`packages/math/src/wgsl/integer.ts`), which writes the exponent bits. Each
// old expression runs here in JavaScript (`shaderRun`), in float32, against the shipped
// declaration, over every exponent its sites can take: the bits are the same.
//
// - `exp2(f32(n))`: the cone walk's mip levels (`coneShader.ts`, `coneFilterShader.ts`), from 0 to
//   the radiance chain's last level, under 31 for any texture under 2³¹ texels a side; and the
//   shadow receiver's offset exponent (`receiverTargetWgsl.ts`), clamped to [−26, 4].
// - `f32(1<<u32(n))`, an `i32` shift: the screen walk's pyramid levels (`traceShader.ts`), the same
//   mip levels; the `i32` holds 2^n up to n = 30.
// - `f32(1u<<n)`: a lamp's fallback page's coarser-level count (`shadowWgsl.ts`,
//   `vsmFilterPage`), a gap between two of its `VSM_MIPS` levels (`pmFallbacksLocal`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { pow2FromExponent } from '../../../math/src/wgsl/integer.ts'
import { VSM_MIPS } from '../vsm/constants.ts'

type Power = (n: number) => number

const OLD = `fn byExp2(n:i32)->f32{return exp2(f32(n));}
fn bySignedShift(n:i32)->f32{return f32(1<<u32(n));}
fn byShift(n:u32)->f32{return f32(1u<<n);}`

const old = shaderRun<{ byExp2: Power; bySignedShift: Power; byShift: Power }>(
  OLD,
  ['byExp2', 'bySignedShift', 'byShift'],
  {},
)
const now = shaderRun<{ pow2FromExponent: Power }>(
  pow2FromExponent,
  ['pow2FromExponent'],
  {},
).pow2FromExponent

/** The float32 bits of `x`. */
const bits = (x: number) => new Uint32Array(Float32Array.of(x).buffer)[0]

function assertSame(form: Power, low: number, high: number, label: string) {
  for (let n = low; n <= high; n++)
    assert.equal(bits(form(n)), bits(now(n)), `${label}: 2^${n} differs`)
}

test('exp2 of an integer exponent is pow2FromExponent over the levels and the receiver exponents', () => {
  assertSame(old.byExp2, 0, 30, 'mip level')
  assertSame(old.byExp2, -26, 4, 'receiver offset exponent')
})

test('an integer shift is pow2FromExponent over the pyramid levels and a lamp’s level gaps', () => {
  assertSame(old.bySignedShift, 0, 30, 'pyramid level')
  assert.ok(VSM_MIPS <= 32, 'a lamp’s level gap stays under the shift’s 32 bits')
  assertSame(old.byShift, 0, VSM_MIPS - 1, 'lamp level gap')
})
