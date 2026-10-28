// The energy terms weigh the table's two shares on the reflectance (`energyTerms`): the albedo under a Fresnel of one by the
// reflectance, the share under the fifth power by the grazing value less the reflectance, the whole times the weight that restores the
// energy the lobe's single scattering misses.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { ENERGY_TERMS_WGSL } from './energyTermsWgsl.ts'

type Vec3 = [number, number, number]
const near = (got: number[], want: number[], what: string) =>
  want.forEach((w, k) => assert.ok(Math.abs(got[k]! - w) < 1e-6, `${what}: ${got} against ${want}`))

/** `energyTerms` on a table that answers the pair `pair` everywhere. */
const weighed = (f0: Vec3, f90: number, pair: [number, number]) =>
  shaderRun<{ energyTerms: (...args: unknown[]) => Vec3 }>(
    wgslModule(ENERGY_TERMS_WGSL),
    ['energyTerms'],
    { shadingEnergyPair: () => pair },
  ).energyTerms(f0, f90, 0.5, 0.5)

test('a lobe that loses no energy is weighed on its reflectance as the split sum says', () => {
  near(
    weighed([0.5, 0.25, 0.1], 1, [1, 0.25]),
    [0.5 + 0.5 * 0.25, 0.25 + 0.75 * 0.25, 0.1 + 0.9 * 0.25],
    'no loss',
  )
})

test('a lobe that keeps a third of the light sends back all of it on a perfect reflector, and little more than the lobe on a dielectric', () => {
  // E = 1/3 under a Fresnel of one: a reflectance of one is weighed by 1 + 1 · 2 = 3, so the lobe returns 3 · 1/3 = 1.
  near(weighed([1, 1, 1], 1, [1 / 3, 0]), [1, 1, 1], 'a metal')
  // A reflectance of 0.04: W = 1 + 0.04 · 2 = 1.08, the lobe 1.08 · 0.04 / 3.
  near(
    weighed([0.04, 0.04, 0.04], 1, [1 / 3, 0]),
    [(1.08 * 0.04) / 3, (1.08 * 0.04) / 3, (1.08 * 0.04) / 3],
    'a dielectric',
  )
})
