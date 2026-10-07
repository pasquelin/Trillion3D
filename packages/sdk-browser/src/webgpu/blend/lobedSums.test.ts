// A blend pass's lobed program (`physicalWgsl.ts`, a key without `lobeless`) lights a fragment that
// carries no lobe as the program without lobe code: its light loop (`sliceLighting`) runs in f32
// (`shaderRun`, `F32_SCOPE`) on random lamp sets — points, spots and suns, in range and past it,
// standard, diffuse and toon, thin or not, on a cell's list and on every lamp —, lobes off, and
// lobes set with neither a strength nor a coat (what `setLobes` leaves of maps that zeroed both):
// the sums are the same numbers, bit for bit. A lobed fragment is proved on the GPU
// (`tests/gpu/blend/lobes.gpu.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { F32_SCOPE } from '../../lighting/shaderRunF32.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../../lighting/standardLighting.ts'
import { blendShader } from './shader.ts'
import { randomLampScope } from './shadedLightScope.fixture.ts'

type Sum = (...args: unknown[]) => number[]
const LOOP = [
  'sliceLighting',
  'declaredLight',
  'directIncidence',
  'rangeWindow',
  'isSun',
  'isSunKind',
  'isRect',
  'modelLight',
  'thinTransmission',
  ...[...STANDARD_LIGHTING_WGSL.matchAll(/fn (\w+)\(/g)].map(([, name]) => name),
]
const LOBED = [...LOOP, 'lobeLight', 'anisotropicLobe']
/** Lobes off, and on with nothing: no strength, no coat, a coat that lets everything through. */
const OFF = { on: false }
const NOTHING = { on: true, strength: 0, coat: 0, coatRough: 0.5, coatN: [0, 0, 1], through: 1 }

test('the lobed blend program sums a fragment without lobes as the lobeless one, bit for bit', () => {
  const r = random(2207),
    u = (lo: number, hi: number) => lo + (hi - lo) * r()
  const key = { rectless: true, unshadowed: true }
  const lobed = blendShader(key),
    plain = blendShader({ ...key, lobeless: true })
  assert.notEqual(lobed, plain)
  const K = wgslConstants(plain)
  let lit = 0,
    sums = 0
  for (let round = 0; round < 160; round++) {
    const { count, P, normal: N, scope: shared } = randomLampScope(r, u, K, round, () => -1)
    const scope = { ...F32_SCOPE, ...shared, shadowTransmission: [1, 1, 1] }
    const surface = [[u(0, 1), u(0, 1), u(0, 1)], u(0, 1), u(0.06, 1), N, [0.6, 0.8, 0], P, 1]
    const sum = (text: string, names: string[], lobes: object, slice: number[]) =>
      shaderRun<Record<string, Sum>>(text, names, { ...scope, lobes }).sliceLighting(
        ...surface,
        slice,
      )
    for (const slice of [
      [2, scope.tileLights.length - 2],
      [K.TILE_NO_SLICE, count],
    ]) {
      const theirs = sum(plain, LOOP, OFF, slice)
      for (const lobes of [OFF, NOTHING]) {
        const ours = sum(lobed, LOBED, lobes, slice)
        assert.ok(
          ours.every((v, i) => Object.is(v, theirs[i])),
          `round ${round}, lobes ${lobes.on}: ${ours} against ${theirs}`,
        )
      }
      lit += +theirs.some((v) => v > 0)
      sums++
    }
  }
  assert.ok(lit > sums * 0.6, `${lit} of ${sums} sums lit`)
})
