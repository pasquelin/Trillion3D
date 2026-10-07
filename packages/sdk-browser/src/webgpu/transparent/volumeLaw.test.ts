// The water's per-volume terms move to the CPU, in f64 (`writeVolumeRecords`, `volumeAttenuation`),
// and its Schlick power is two squares and a product: each against its exact value in f64, in the
// f32 a GPU shades in (transcendentals correctly rounded, the best a device does; `exp` lowered to
// `exp2(x·log2 e)` as Tint, Metal and HLSL lower it). The attenuation's worst error halves and more
// of its values come closer than go further; f0, 1 / ior and x⁵ come within an ULP or three of
// what `pow` and the divide left tens of ULPs from. A black volume transmits nothing past a zero
// path, in the water as in its shadow, where the water let 10⁻⁵ of it through and the shadow's
// `pow(0, y)` is undefined. The shadow's raster keeps its per-fragment `c^(x / d)` on every colour
// that is not black, bit for bit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../../lighting/shaderRunF32.fixture.ts'
import { functionText } from '../../bounce/wgslBody.fixture.ts'
import { waterCompositeShader } from '../water/compositeWgsl.ts'
import { VOLUME_LAW_WGSL, volumeAttenuation } from './volumeLaw.ts'

const f = Math.fround,
  LOG2E = f(Math.LOG2E)
const ulp = (x: number) => {
  const word = new Float32Array([Math.abs(x)]),
    bits = new Uint32Array(word.buffer)
  const at = word[0]
  bits[0]++
  return word[0] - at
}
const error = (value: number, exact: number) => Math.abs(value - exact) / ulp(exact)
let seed = 1563
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
/** The best f32 `pow(x, y)` WGSL allows: exp2(y·log2 x), each correctly rounded. */
const pow = (x: number, y: number) => f(2 ** f(y * f(Math.log2(x))))

test('the water attenuation from its f64 constant is closer to c^(x / d) than the per-pixel log and exp', () => {
  const develop = (c: number, d: number, x: number) => {
    const sigma = f(-f(Math.log(f(Math.min(Math.max(c, f(1e-5)), 1)))) / d)
    return f(2 ** f(f(-sigma * x) * LOG2E))
  }
  const k = [0, 0, 0]
  const shipped = (c: number, d: number, x: number) =>
    f(2 ** f(f(volumeAttenuation([c, c, c], d, k)[0]) * x))
  let worstDevelop = 0,
    worstShipped = 0,
    closer = 0,
    further = 0
  for (let i = 0; i < 400_000; i++) {
    const c = f(1e-5 + random() * (1 - 1e-5)),
      d = f(10 ** (random() * 4 - 2)),
      x = f(random() * 4 * d)
    const exact = c ** (x / d)
    if (exact < 1e-30) continue
    const [a, b] = [error(develop(c, d, x), exact), error(shipped(c, d, x), exact)]
    worstDevelop = Math.max(worstDevelop, a)
    worstShipped = Math.max(worstShipped, b)
    closer += +(b < a)
    further += +(b > a)
  }
  assert.ok(worstShipped < 0.75 * worstDevelop, `${worstShipped} against ${worstDevelop} ULP`)
  assert.ok(closer > 2 * further, `${closer} closer, ${further} further`)
})

test('f0, 1 / ior and the fifth power come within ULPs of their exact values', () => {
  let f0Develop = 0,
    f0Shipped = 0,
    etaDevelop = 0,
    etaShipped = 0
  for (let i = 0; i < 200_000; i++) {
    const ior = 1 + random() * 2,
      stored = f(ior)
    const r = (ior - 1) / (ior + 1)
    f0Develop = Math.max(f0Develop, error(pow(f(f(stored - 1) / f(stored + 1)), 2), r * r))
    f0Shipped = Math.max(f0Shipped, error(f(r * r), r * r))
    etaDevelop = Math.max(etaDevelop, error(f(1 / stored), 1 / ior))
    etaShipped = Math.max(etaShipped, error(f(1 / ior), 1 / ior))
  }
  assert.ok(f0Shipped <= 0.5 && f0Develop > 4, `f0 ${f0Shipped} against ${f0Develop} ULP`)
  assert.ok(etaShipped <= 0.5 && etaDevelop > 0.5, `1 / ior ${etaShipped} against ${etaDevelop}`)
  let fifthDevelop = 0,
    fifthShipped = 0
  for (let i = 0; i < 400_000; i++) {
    const x = f(i < 200_000 ? random() : 1 - random() * 1e-3),
      exact = x ** 5
    if (exact < 1e-30) continue
    const x2 = f(x * x)
    fifthDevelop = Math.max(fifthDevelop, error(pow(x, 5), exact))
    fifthShipped = Math.max(fifthShipped, error(f(f(x2 * x2) * x), exact))
  }
  assert.ok(fifthShipped < 3 && fifthDevelop > 20, `x⁵ ${fifthShipped} against ${fifthDevelop}`)
})

test('a black volume transmits nothing past a zero path, in the water and in its shadow', () => {
  const { volumeTransmittance, volumeTransmittanceOf } = shaderRun<{
    volumeTransmittance: (k: number[], path: number) => number[]
    volumeTransmittanceOf: (colour: number[], distance: number, path: number) => number[]
  }>(VOLUME_LAW_WGSL, ['volumeTransmittance', 'volumeTransmittanceOf'], F32_SCOPE)
  const k = volumeAttenuation([0, 0.5, 2], 3)
  assert.deepEqual(k, [-(2 ** 64), -1 / 3, 0])
  assert.deepEqual(volumeAttenuation([0, 0.5, 1], 0), [0, 0, 0], 'no volume')
  assert.deepEqual(volumeAttenuation([0.5, 0.5, 0.5], Infinity), [-0, -0, -0], 'no absorption')
  for (const path of [1e-12, 0.01, 3, 1e5]) {
    assert.deepEqual(volumeTransmittance(k.map(f), path).slice(0, 1), [0], `water, ${path}`)
    assert.deepEqual(volumeTransmittanceOf([0, 0.5, 2], 3, path)[0], 0, `shadow, ${path}`)
  }
  assert.deepEqual(volumeTransmittance(k.map(f), 0), [1, 1, 1])
  assert.deepEqual(volumeTransmittanceOf([0, 0.5, 2], 3, 0), [1, 1, 1])
  // Develop's water at a twentieth of the distance: 10⁻⁵ to the 1/20 lets through more than half.
  assert.ok(f(1e-5) ** (1 / 20) > 0.5)
  // Any other colour: the shadow's power as it stood, pow(c, x / d).
  for (let i = 0; i < 10_000; i++) {
    const c = [random(), random(), random()].map(f),
      d = f(0.01 + random() * 10),
      x = f(random() * 4 * d)
    const shipped = volumeTransmittanceOf(c, d, x)
    c.forEach((v, j) => assert.ok(Object.is(shipped[j], f(v ** f(x / d)))))
  }
})

test('the composite reads the per-volume terms and the shadow its law', () => {
  const composite = waterCompositeShader()
  assert.match(
    composite,
    /struct Volume\{transmission:f32,eta:f32,thickness:f32,f0:f32,attenuation:vec4f,\}/,
  )
  assert.match(composite, /refract\(-V,N,vol\.eta\)/)
  assert.match(composite, /sample\.rgb\*volumeTransmittance\(vol\.attenuation\.rgb,path\)/)
  // Fresnel on the volume's reflectance through the engine's one fifth-power term.
  assert.match(
    functionText(composite, 'waterColor'),
    /let F=fresnelScalar\(vol\.f0,max\(dot\(Nv,V\),0\.0\)\);/,
  )
  assert.match(
    functionText(composite, 'fresnelScalar'),
    /let x=clamp\(1\.0-cosine,0\.0,1\.0\);let x2=x\*x;return f0\+\(1\.0-f0\)\*\(x2\*x2\*x\);/,
  )
  for (const name of ['waterColor', 'transmittedBackdrop', 'fresnelScalar'])
    assert.doesNotMatch(functionText(composite, name), /pow\(|log\(|exp\(|\/max\(vol/)
})
