// A floor reflects what the image does not hold — the hidden side of an emissive body, a thin post between
// two bodies, a blended shell's far wall —, and the run-time proxy (a world made at run time has no cooked
// one) answers where the screen cannot. Proved on a generated FAMILY (`runtimeFamilyCases.ts`): each case is
// a seed's scene — 1 to 50 spheres, boxes, tori, posts, quads, discs and morphed spheres, emitting or dark,
// opaque or blended, still or moving —, over a metal or a dielectric floor of roughness 0 to 0.6, seen from
// grazing to straight down, with the temporal accumulation on or off. The rule is analytic
// (`runtimeFamilyExpect.ts`): at each floor pixel the exact geometry gives the lobe's radiance and the
// floor's split-sum weight, and the reflection target the engine wrote must show it within the declared
// tolerance — a hit pixel the body's radiance, a miss pixel the (black) environment. A case passes at
// `PASS_RATE` of its decided pixels; the worst pixel of each case is reported.
//
//   node bench/dawn/proofs.ts tests/gpu/reflections/runtime-proxy.gpu.ts
//   TRILLION3D_CASE=<n> draws that case alone
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { loadPage, runOnDawn } from '../kit/onDawn.ts'
import { FRAME_WORK } from '../../../packages/sdk-browser/src/bounce/runtimeLayout.ts'
import { FAMILY_SIZE, familyCase } from './runtimeFamilyCases.ts'
import { expectedFloor, judge, TOLERANCE } from './runtimeFamilyExpect.ts'

const PASS_RATE = 0.95
/** Cases that must reach the pass rate: all of them. */
const rates: number[] = []

const only = process.env.TRILLION3D_CASE
for (let index = 0; index < FAMILY_SIZE; index++)
  if (only === undefined || Number(only) === index)
    test(
      `case ${index}: the floor shows the shapes' radiance within ${TOLERANCE.relative * 100}%`,
      { timeout: 300_000 },
      async () => {
        const c = familyCase(index)
        const page = (await loadPage(
          resolve(import.meta.dirname, 'runtimeFamilyPage.ts'),
          'reflectionFamily',
        )) as typeof import('./runtimeFamilyPage.ts')
        const result = await runOnDawn(page.run, index)
        if (result.error) console.log(`CASE ${index} ERROR ${String(result.error).slice(0, 600)}`)
        assert.equal(result.error, undefined, result.error)
        assert.deepEqual(result.errors, [])
        assert.deepEqual(result.worldErrors, [], "the world's own device raised no error")
        const { width = 0, height = 0, samples = [], frames = 0, spent = 0, left = 0 } = result
        const decided = expectedFloor(c, width, height)
        const { passed, rate, worst } = judge(decided, samples)
        rates.push(rate)
        console.log(
          JSON.stringify({
            index,
            seed: c.seed,
            shapes: c.shapes.length,
            floor: c.floor,
            taa: c.temporal,
            frames,
            decided: decided.length,
            passed,
            rate: Number(rate.toFixed(3)),
            worst: { ...worst, off: Number(worst.off.toFixed(2)) },
            spent,
            left,
            budget: FRAME_WORK,
          }),
        )
        assert.ok(decided.length >= 20, `${decided.length} decided floor pixels`)
        assert.ok(left === 0, `${left} pixels left for a later frame`)
        assert.ok(
          rate >= PASS_RATE,
          `${passed} of ${decided.length} decided pixels pass (${rate.toFixed(3)})`,
        )
      },
    )

test('the worst case of the family', () => {
  console.log(JSON.stringify({ worstRate: Math.min(...rates), cases: rates.length }))
})
