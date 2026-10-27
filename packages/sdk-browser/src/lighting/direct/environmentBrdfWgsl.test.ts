// The environment BRDF weighs the table's two shares on the reflectance (`environmentBrdf`): the share under a Fresnel of one
// by the reflectance, the share under its fifth power by the grazing value the composites give it, the green channel's alone
// (`envBrdfF90`); the lights' own grazing value is the greatest channel's (`slabF90`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { envBrdfF90, slabF90 } from '../../../../math/src/wgsl/lighting.ts'
import { ENVIRONMENT_BRDF_WGSL } from './environmentBrdfWgsl.ts'

type Vec3 = [number, number, number]
const near = (got: number[], want: number[], what: string) =>
  want.forEach((w, k) => assert.ok(Math.abs(got[k]! - w) < 1e-6, `${what}: ${got} against ${want}`))

/** `environmentBrdf` on a table that answers the shares `pair` everywhere. */
const weighed = (f0: Vec3, pair: [number, number], grazing: (f0: Vec3) => number = green) =>
  shaderRun<{ environmentBrdf: (...args: unknown[]) => Vec3 }>(
    wgslModule(ENVIRONMENT_BRDF_WGSL),
    ['environmentBrdf'],
    { environmentBrdfPair: () => pair },
  ).environmentBrdf(f0, grazing(f0), 0.5, 0.5)
/** The grazing value of the water's and the coat's composites, the green channel's (`envBrdfF90`), and of the slab's, the greatest
 *  channel's (`slabF90`), as the tests state them. */
const green = (f0: Vec3) => Math.min(Math.max(50 * f0[1], 0), 1)
const greatest = (f0: Vec3) => Math.min(Math.max(50 * Math.max(...f0), 0), 1)

test('the grazing value of the environment BRDF is the green channel’s, held to one: a reflectance whose green is low is dimmed, whatever its red', () => {
  // Red 0.5, green 0.01: the green channel says 0.5 of a grazing value, the greatest channel would say 1.
  near(weighed([0.5, 0.01, 0.01], [0.5, 0.25]), [0.375, 0.13, 0.13], 'green')
  near(weighed([0.04, 0.04, 0.04], [1, 1]), [1.04, 1.04, 1.04], 'a dielectric: green saturates')
})

test('the grazing value is the caller’s: the slab’s composite gives the greatest channel’s', () => {
  // The same reflectance and table: the grazing value of one says 0.5, the other 1.
  near(weighed([0.5, 0.01, 0.01], [0.5, 0.25], greatest), [0.5, 0.255, 0.255], 'greatest')
  near(weighed([0.5, 0.01, 0.01], [0.5, 0.25], green), [0.375, 0.13, 0.13], 'green')
})

test('the lights’ grazing value is the greatest channel’s, the environment’s the green’s: two rules, two functions', () => {
  const run = shaderRun<{ slabF90: (f0: Vec3) => number; envBrdfF90: (f0: Vec3) => number }>(
    wgslModule(slabF90, envBrdfF90),
    ['slabF90', 'envBrdfF90'],
    {},
  )
  assert.equal(run.slabF90([0.5, 0.01, 0.01]), 1)
  assert.equal(run.envBrdfF90([0.5, 0.01, 0.01]), 0.5)
  assert.equal(run.slabF90([0.001, 0.005, 0.01]), 0.5)
  assert.equal(run.envBrdfF90([0.001, 0.005, 0.01]), 0.25)
})
