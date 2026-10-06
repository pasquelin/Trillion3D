// The blend and water programs of a scene with no shadowed light, or no rectangle light, are
// compiled without that code, as the opaque resolve's (`createForwardVariants`). The
// shipped light loops of the blend pass (`sliceLighting`) and of the water composite
// (`sliceLightingPair`) run in f32 (`shaderRun`, `F32_SCOPE`), each variant against the program with
// every code path, on random lamp sets the variant's key admits — points, spots and suns, in range
// and past it, shadowed or not where the key keeps the shadow code, standard, diffuse and toon,
// thin or not, on a cell's list and on every lamp —: the sums are the same numbers, bit for bit.
// The rectangle's term needs the LTC table: no lamp of these sets is one, and the program with
// rectangle code holds the same text for it (`rectlessResolve.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../texture/shaderRule.fixture.ts'
import { F32_SCOPE } from '../../lighting/shaderRunF32.fixture.ts'
import { STANDARD_LIGHTING_WGSL } from '../../lighting/standardLighting.ts'
import { blendShader } from './shader.ts'
import { shadedLightScope } from './shadedLightScope.fixture.ts'
import { waterCompositeShader } from '../water/compositeWgsl.ts'
import type { ContractKey } from '../../lighting/deferred/contractVariants.ts'

type Sum = (...args: unknown[]) => number[] | { lit: number[]; specular: number[] }
const SHARED = [
  'directIncidence',
  'rangeWindow',
  'isSun',
  'isSunKind',
  'isRect',
  'modelLight',
  'thinTransmission',
  ...[...STANDARD_LIGHTING_WGSL.matchAll(/fn (\w+)\(/g)].map(([, name]) => name),
]
/** What the shadow read does for a light with no slot: no transmission, a factor of one. */
const NO_SLOT =
  /fn shadowFactor\([^)]*\)->f32\{\n shadowTransmission=vec3f\(1\.0\);\n if\(slice<0\)\{return 1\.0;\}/

/** The pass's program at a key, and the loop it walks its lights with. */
const PASSES = {
  blend: {
    text: (key: Partial<ContractKey>) => blendShader(key),
    loop: ['sliceLighting', 'declaredLight'],
  },
  water: {
    text: (key: Partial<ContractKey>) => waterCompositeShader(false, key),
    loop: ['sliceLightingPair', 'declaredLightPair'],
  },
}
/** The keys a scene can have: each cut alone, and together where they can be (`contractKey`). */
const KEYS: Partial<ContractKey>[] = [
  { rectless: true },
  { unshadowed: true },
  { unshadowed: true, rectless: true },
  { sunless: true },
  { localless: true },
  { sunless: true, rectless: true },
  { localless: true, rectless: true },
]
const flat = (sum: ReturnType<Sum>) => (Array.isArray(sum) ? sum : [...sum.lit, ...sum.specular])

test('each forward variant sums what the program with every code path sums, bit for bit, in f32', () => {
  const r = random(1832),
    u = (lo: number, hi: number) => lo + (hi - lo) * r()
  let lit = 0,
    sums = 0
  for (const [name, pass] of Object.entries(PASSES)) {
    const full = pass.text({})
    assert.match(full, NO_SLOT)
    const K = wgslConstants(full)
    for (const key of KEYS) {
      const variant = pass.text(key)
      assert.notEqual(variant, full)
      for (let round = 0; round < 120; round++) {
        const count = 1 + Math.floor(u(0, 16))
        const P = [u(-5, 5), u(-1, 3), u(-5, 5)]
        const kept = (kind: number) =>
          !key.unshadowed && !(kind === K.KIND_SUN ? key.sunless : key.localless)
        const items = [...Array(count).keys()].map((rank) => {
          const kind = [0, K.KIND_SPOT, K.KIND_SUN][rank % 3]
          return {
            positionRange: [P[0] + u(-4, 4), P[1] + u(-4, 4), P[2] + u(-4, 4), u(0.1, 8)],
            colorIntensity: [u(0, 1), u(0, 1), u(0, 1), u(0, 20)],
            directionCone: [u(-0.5, 0.5), -1, u(-0.5, 0.5), kind === K.KIND_SPOT ? 0.7 : -1],
            // A slot where the key keeps the shadow code of the light's kind; none where it leaves it out.
            params: [kind, kept(kind) && rank % 2 ? rank : -1, 0, kind === K.KIND_SPOT ? 0.9 : 0],
            shape: [u(0, 0.05), 0, 0, 0],
          }
        })
        const { normal: N, scope: shared } = shadedLightScope(r, u, K, count, items, round)
        const scope = {
          ...F32_SCOPE,
          ...shared,
          // A slot's read is the light's own; with none, the shipped read's one (`NO_SLOT`).
          shadowTransmission: items.some((item) => item.params[1] >= 0)
            ? [0.9, 0.7, 0.5]
            : [1, 1, 1],
          LightPair: (a: number[], b: number[]) => ({ lit: a, specular: b }),
        }
        const surface = [[u(0, 1), u(0, 1), u(0, 1)], u(0, 1), u(0.06, 1), N, [0.6, 0.8, 0], P, 1]
        const sum = (text: string, slice: number[]) =>
          flat(
            shaderRun<Record<string, Sum>>(text, [...pass.loop, ...SHARED], scope)[pass.loop[0]](
              ...surface,
              slice,
            ),
          )
        for (const slice of [
          [2, scope.tileLights.length - 2],
          [K.TILE_NO_SLICE, count],
        ]) {
          const ours = sum(variant, slice),
            theirs = sum(full, slice)
          assert.ok(
            ours.every((v, i) => Object.is(v, theirs[i])),
            `${name} ${JSON.stringify(key)} round ${round}: ${ours} against ${theirs}`,
          )
          lit += +ours.some((v) => v > 0)
          sums++
        }
      }
    }
  }
  assert.ok(lit > sums * 0.6, `${lit} of ${sums} sums lit`)
})
