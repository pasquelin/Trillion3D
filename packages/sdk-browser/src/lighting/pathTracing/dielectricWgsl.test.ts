// The path tracer's glass interface run from the shipped text: its energy, and the density a sample reports against the one an evaluation gives.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { PT_DIELECTRIC_WGSL } from './dielectricWgsl.ts'

type V3 = [number, number, number]
interface Glass {
  direction: V3
  weight: number
  pdf: number
  refracted: boolean
}
const glass = () =>
  shaderRun<{
    ptGlassSample: (v: V3, alpha: number, eta: number, f0: number, e: V3) => Glass
    ptGlassEval: (l: V3, v: V3, alpha: number, eta: number, f0: number) => [number, number]
  }>(PT_DIELECTRIC_WGSL, ['ptGlassSample', 'ptGlassEval'], {})

/** Van der Corput / Halton points in [0,1)^3. */
const halton = (i: number, base: number) => {
  let f = 1,
    r = 0
  for (let n = i + 1; n > 0; n = Math.floor(n / base)) {
    f /= base
    r += f * (n % base)
  }
  return r
}
const unit = (v: V3): V3 => {
  const n = Math.hypot(...v)
  return [v[0] / n, v[1] / n, v[2] / n]
}

test('a glass of rough surface sends back the light it receives: the weights of its samples average one', () => {
  const g = glass()
  const v = unit([0.4, 0.1, 0.9])
  for (const alpha of [0.05, 0.25])
    for (const eta of [1.5, 1 / 1.5]) {
      let sum = 0
      const n = 4000
      for (let i = 0; i < n; i++) {
        const s = g.ptGlassSample(v, alpha, eta, 0.04, [halton(i, 2), halton(i, 3), halton(i, 5)])
        if (s.pdf > 0) sum += s.weight
      }
      const mean = sum / n
      assert.ok(mean > 0.85 && mean < 1.05, `alpha ${alpha} eta ${eta}: ${mean}`)
    }
})

test('a direction a sample reports is evaluated at the same density and weight', () => {
  const g = glass()
  const v = unit([0.3, -0.2, 0.8])
  let checked = 0
  for (let i = 0; i < 200; i++) {
    const s = g.ptGlassSample(v, 0.3, 1.5, 0.04, [halton(i, 2), halton(i, 3), halton(i, 5)])
    if (!(s.pdf > 1e-4)) continue
    const [weight, pdf] = g.ptGlassEval(unit(s.direction), v, 0.3, 1.5, 0.04)
    assert.ok(
      Math.abs(pdf - s.pdf) <= 1e-3 * Math.max(1, s.pdf),
      `pdf ${pdf} ${s.pdf} refracted ${s.refracted}`,
    )
    assert.ok(Math.abs(weight - s.weight) <= 1e-3, `weight ${weight} ${s.weight}`)
    checked++
  }
  assert.ok(checked > 100)
})

test('a smooth glass at normal incidence reflects its Fresnel share and refracts the rest', () => {
  const g = glass()
  let refracted = 0
  const n = 2000
  for (let i = 0; i < n; i++) {
    const s = g.ptGlassSample([0, 0, 1], 0.01, 1.5, 0.04, [0.5, 0.5, (i + 0.5) / n])
    if (s.refracted) refracted++
  }
  assert.ok(Math.abs(refracted / n - 0.96) < 0.01)
})
