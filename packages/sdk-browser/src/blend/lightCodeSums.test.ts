// The blend programs — every translucent layer's — of a scene with no shadowed light, or no
// rectangle light, are compiled without that code, as the opaque resolve's
// (`createForwardVariants`). The shipped light loop of the blend pass (`sliceLighting`) runs in f32 (`shaderRun`, `F32_SCOPE`), each variant against the program with
// every code path, on random lamp sets the variant's key admits — points, spots and suns, in range
// and past it, shadowed or not where the key keeps the shadow code, standard, diffuse and toon,
// thin or not, on a cell's list and on every lamp —: the sums are the same numbers, bit for bit.
// The rectangle's term needs the LTC table: no lamp of these sets is one, and the program with
// rectangle code holds the same text for it (`rectlessResolve.test.ts`).
import { lerp } from '../../../math/src/scalar/reals.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../materials/texture/shaderRule.fixture.ts'
import { F32_SCOPE } from '../lighting/shaderRunF32.fixture.ts'
import { DEFAULT_TRANSLUCENT_SCENE, blendShader } from './shader.ts'
import { randomLampScope, type Sum } from './shadedLightScope.fixture.ts'
import type { ContractKey } from '../lighting/deferred/contractCuts.ts'
import { lcgRandom } from '../../../math/src/sequence/random.ts'
import { TRANSLUCENT_SHADOW_DEFAULT } from '../lighting/direct/shadowWgsl.ts'

/** The scene whose translucent programs light a rectangle light as a rectangle (`translucentRectLights`). */
const RECT_LIGHTS = { ...DEFAULT_TRANSLUCENT_SCENE, rectLights: true }

/** What the shadow read does for a light with no slot: a factor of one. */
const NO_SLOT = /fn shadowFactor\([^)]*\)->f32\{\n if\(slice<0\)\{return 1\.0;\}/

/** The pass's program at a key, and the loop it walks its lights with. */
const PASSES = {
  blend: {
    // The programs of a scene without lobes; the lobed ones sum as they do (`lobedSums.test.ts`).
    // With the rectangle code a key keeps (`translucentRectLights`, off by default).
    text: (key: Partial<ContractKey>) =>
      blendShader({ ...key, lobeless: true }, { scene: RECT_LIGHTS }),
    loop: ['sliceLighting', 'declaredLight'],
  },
}
/** The keys a scene can have: each cut alone, and together where they can be (`contractKey`). */
/** A key whose one cut is the local lights' shadow code, which a translucent program holds only
 *  under `shadowTranslucentLocalLights` (`directShadowWgsl`): without it, nothing is left to cut. */
const cutsNothing = (key: Partial<ContractKey>) =>
  !TRANSLUCENT_SHADOW_DEFAULT.localShadows &&
  !!key.localless &&
  !key.rectless &&
  !key.unshadowed &&
  !key.sunless
const KEYS: Partial<ContractKey>[] = [
  { rectless: true },
  { unshadowed: true },
  { unshadowed: true, rectless: true },
  { sunless: true },
  { localless: true },
  { sunless: true, rectless: true },
  { localless: true, rectless: true },
]

test('each forward variant sums what the program with every code path sums, bit for bit, in f32', () => {
  const r = lcgRandom(1832),
    u = (lo: number, hi: number) => lerp(lo, hi, r())
  let lit = 0,
    sums = 0
  for (const [name, pass] of Object.entries(PASSES)) {
    const full = pass.text({})
    assert.match(full, NO_SLOT)
    const K = wgslConstants(full)
    for (const key of KEYS) {
      const variant = pass.text(key)
      if (cutsNothing(key)) assert.equal(variant, full, `${JSON.stringify(key)}: no code to cut`)
      else assert.notEqual(variant, full, JSON.stringify(key))
      for (let round = 0; round < 120; round++) {
        const kept = (kind: number) =>
          !key.unshadowed && !(kind === K.KIND_SUN ? key.sunless : key.localless)
        // A slot where the key keeps the shadow code of the light's kind; none where it drops it.
        const slot = (kind: number, rank: number) => (kept(kind) && rank % 2 ? rank : -1)
        const { count, P, normal: N, scope: shared } = randomLampScope(r, u, K, round, slot)
        const scope = { ...F32_SCOPE, ...shared }
        const surface = [[u(0, 1), u(0, 1), u(0, 1)], u(0, 1), u(0.06, 1), N, [0.6, 0.8, 0], P, 1]
        const sum = (text: string, slice: number[]) =>
          shaderRun<Record<string, Sum>>(text, pass.loop, scope)[pass.loop[0]](...surface, slice)
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

test('a rectangle light is lit as a rectangle only where the project switch says: the program holds no rectangle code without it', () => {
  const lobeless = { lobeless: true }
  const off = blendShader(lobeless)
  assert.equal(
    off,
    blendShader({ ...lobeless, rectless: true }),
    'off by default: as a scene with none',
  )
  assert.equal(off, blendShader(lobeless, { scene: DEFAULT_TRANSLUCENT_SCENE }))
  const on = blendShader(lobeless, { scene: RECT_LIGHTS })
  assert.notEqual(on, off)
  assert.equal(
    blendShader({ ...lobeless, rectless: true }, { scene: RECT_LIGHTS }),
    off,
    'a scene with none holds none either way',
  )
})
