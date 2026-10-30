// The surface shadow of a light starts at the material's occlusion and its shadow replaces it where the
// light has shadow bits — the value its record holds, 3 for a dynamic shadow, 1 for a static one or a light function
// that holds no slot of the atlas, even at shadow quality 0 —, whether or not it holds a slot or the program holds the shadow
// code (then its shadow is 1); the transmission shadow stays 1. The shipped loop runs in f32 (`shaderRun`), in the program with the shadow code
// and in the one without, on lamps around a point: a lamp that casts no shadow is multiplied by `ao` on its
// lobes alone — the thin back's transmission is not —, a lamp that casts one is not, with a slot or without,
// the diffuse model takes the occlusion as the others do (once, and not on a shadowed light), and
// the two programs give the same sum bit for bit where no lamp casts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { NO_SHADING_MODEL } from './shadingModelScope.fixture.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { MODEL_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import { PIXEL_MODEL } from '../../materials/surface/pixelModel.ts'
import {
  LIGHT_FLAG,
  LIGHT_SHADOWED,
  LIGHT_SHADOWED_SHIFT,
} from '../../../../sdk-core/src/scene/light/contracts.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { directLightingWgsl } from './lightLoop.fixture.ts'
import { testLight } from './testLight.fixture.ts'
import { kindLane } from '../../../../sdk-core/src/scene/light/lanes.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

type Sum = (...args: unknown[]) => number[]

/** Three lamps above the point and their mirrors below it, casting a shadow or not, a slot or none each, with the shadow
 *  bits their record holds. */
const lamps = (casts: boolean, slot: number, bits: number, shares: number[]) =>
  [
    [1, 3, 0.5],
    [-2, 2, 1],
    [0.5, 4, -2],
    [1, -3, 0.5],
    [-2, -2, 1],
    [0.5, -4, -2],
  ].map(([x, y, z]) =>
    testLight({
      positionRange: [x, y, z, 20],
      colorIntensity: [1, 0.8, 0.6, 30],
      directionCone: [0, -1, 0, -2],
      params: [
        kindLane((casts ? LIGHT_FLAG.castsShadow : 0) + (bits << LIGHT_SHADOWED_SHIFT)),
        slot,
        0,
        0,
      ],
      shape: [0, 0, ...shares],
    }),
  )

const SHADOWED = wgslModule(
  directLightingWgsl({ unshadowed: false, rectless: true, lobeless: true }),
  STANDARD_LIGHTING_WGSL,
)
const UNSHADOWED = wgslModule(
  directLightingWgsl({ unshadowed: true, rectless: true, lobeless: true }),
  STANDARD_LIGHTING_WGSL,
)
/** The program that holds the contact shadows' code, which the tests that follow it hand a stand-in. */
const CONTACTING = wgslModule(
  directLightingWgsl({ unshadowed: true, rectless: true, lobeless: true, contactless: false }),
  STANDARD_LIGHTING_WGSL,
)
const K = wgslConstants(SHADOWED)

type Case = {
  /** The lamps cast a shadow. */
  casts?: boolean
  /** The shadow bits of their record (0, 1 or 3); 3 for a lamp that casts, else 0. */
  bits?: number
  /** What the scope holds beside the rest: the contact shadow's stand-in. */
  extra?: object
  slot?: number
  shade?: number
  ao: number
  model?: number
  thin?: number[]
  /** The normal turns down, the eye with it: the lamps above light the sheet's back. */
  down?: boolean
  /** The lamps' shares of their diffuse and specular light (`sharesOf`). */
  shares?: number[]
}

/** The sum of the lamps on the point of a surface, for an occlusion `ao`. */
function sumOf(source: string, c: Case) {
  const {
    casts = false,
    bits = casts ? LIGHT_SHADOWED.dynamic : LIGHT_SHADOWED.none,
    extra = {},
    slot = -1,
    shade = 1,
    ao,
    model = MODEL_FLAG.physical,
    thin = [0, 0, 0],
    down = false,
    shares = [1, 1],
  } = c
  const items = lamps(casts, slot, bits, shares)
  const scope = {
    ...F32_SCOPE,
    ...K,
    directLights: { count: items.length, items },
    tileLights: [],
    ...NO_SHADING_MODEL,
    thinSubsurface: thin,
    surfaceModel: model,
    shadowFactor: (slice: number) => (slice < 0 ? 1 : shade),
    airTintOf: () => [1, 1, 1],
    cloudShadowOnSurface: () => 1,
    ...extra,
  }
  const sign = down ? -1 : 1
  const surface = [[0.6, 0.5, 0.4], 0, 0.5, [0, sign, 0], [0.6, 0.8 * sign, 0], [0, 0, 0], ao]
  return shaderRun<{ sliceLighting: Sum }>(source, ['sliceLighting'], scope).sliceLighting(
    ...surface,
    [K.TILE_NO_SLICE, items.length],
  )
}

const scaled = (sum: number[], by: number) => sum.map((v) => v * by)
const close = (a: number[], b: number[], what: string) =>
  a.forEach((v, i) =>
    assert.ok(Math.abs(v - b[i]) <= 1e-5 * Math.max(1, Math.abs(b[i])), `${what}: ${a} ${b}`),
  )

test('a lamp that casts no shadow gives its lobes the occlusion, in the two programs alike, bit for bit', () => {
  for (const ao of [1, 0.5, 0.25]) {
    const without = sumOf(UNSHADOWED, { ao })
    const dark = sumOf(SHADOWED, { ao })
    assert.ok(
      without.every((v, i) => Object.is(v, dark[i])),
      `ao ${ao}: ${without} against ${dark}`,
    )
  }
  const whole = sumOf(UNSHADOWED, { ao: 1 })
  assert.ok(whole.some((v) => v > 0))
  close(sumOf(UNSHADOWED, { ao: 0.5 }), scaled(whole, 0.5), 'half the occlusion')
  assert.ok(sumOf(UNSHADOWED, { ao: 0 }).every((v) => v === 0))
})

test('a lamp that casts a shadow takes the occlusion from no one: its shadow replaces it, slot or none', () => {
  for (const slot of [2, -1]) {
    const first = sumOf(SHADOWED, { casts: true, slot, shade: slot < 0 ? 1 : 0.7, ao: 1 })
    assert.ok(first.some((v) => v > 0))
    for (const ao of [0.5, 0]) {
      const next = sumOf(SHADOWED, { casts: true, slot, shade: slot < 0 ? 1 : 0.7, ao })
      assert.ok(
        first.every((v, i) => Object.is(v, next[i])),
        `slot ${slot}, ao ${ao}: ${first} against ${next}`,
      )
    }
  }
})

test('at shadow quality 0 a lamp that casts a shadow keeps the static bit: its shadow, 1, replaces the occlusion', () => {
  for (const program of [SHADOWED, UNSHADOWED]) {
    const whole = sumOf(program, { casts: true, bits: LIGHT_SHADOWED.static, ao: 1 })
    assert.ok(whole.some((v) => v > 0))
    for (const ao of [0.5, 0]) {
      const next = sumOf(program, { casts: true, bits: LIGHT_SHADOWED.static, ao })
      assert.ok(
        whole.every((v, i) => Object.is(v, next[i])),
        `ao ${ao}: ${whole} against ${next}`,
      )
    }
  }
})

test('a lamp whose light function holds no slot has the shadow bit: its shadow, 1, replaces the occlusion', () => {
  const whole = sumOf(UNSHADOWED, { bits: LIGHT_SHADOWED.static, ao: 1 })
  assert.ok(whole.some((v) => v > 0))
  for (const ao of [0.5, 0]) {
    const next = sumOf(UNSHADOWED, { bits: LIGHT_SHADOWED.static, ao })
    assert.ok(
      whole.every((v, i) => Object.is(v, next[i])),
      `ao ${ao}: ${whole} against ${next}`,
    )
  }
})

test('a light hands its contact shadow the shadow bits its record holds', () => {
  const bitsOf = (bits: number) => {
    const seen = new Set<unknown>()
    sumOf(CONTACTING, {
      bits,
      ao: 1,
      extra: { contactShadow: (...args: unknown[]) => (seen.add(args[3]), 1) },
    })
    return [...seen]
  }
  for (const bits of Object.values(LIGHT_SHADOWED)) assert.deepEqual(bitsOf(bits), [bits])
})

test('the thin back’s transmission takes no occlusion: only the lobes do', () => {
  const thin = [0.5, 0.4, 0.3]
  const at = (ao: number, colour: number[]) => sumOf(UNSHADOWED, { ao, thin: colour, down: true })
  // The lamps above light the sheet's back through it, the ones below its front.
  const transmitted = at(0, thin)
  assert.ok(
    transmitted.every((v) => v > 0),
    `${transmitted}`,
  )
  assert.ok(at(0, [0, 0, 0]).every((v) => v === 0))
  const lobes = at(1, [0, 0, 0])
  assert.ok(lobes.some((v) => v > 0))
  // The sum is the lobes times `ao` plus the transmission, whatever `ao` is.
  close(
    at(1, thin),
    lobes.map((v, i) => v + transmitted[i]),
    'lobes plus transmission',
  )
  close(
    at(0.5, thin),
    lobes.map((v, i) => v * 0.5 + transmitted[i]),
    'half the lobes plus all the transmission',
  )
})

test('the diffuse model takes the occlusion as the lobes do: from a lamp that casts none, once', () => {
  for (const model of [MODEL_FLAG.diffuse]) {
    const whole = sumOf(UNSHADOWED, { ao: 1, model })
    assert.ok(whole.some((v) => v > 0))
    const half = scaled(whole, 0.5)
    close(sumOf(UNSHADOWED, { ao: 0.5, model }), half, `model ${model}`)
    close(sumOf(SHADOWED, { ao: 0.5, model }), half, `model ${model}, shadow code`)
    // A shadowed lamp replaces the occlusion with its shadow, as it does for every model.
    const shadowed = sumOf(SHADOWED, { casts: true, slot: 2, shade: 0.7, ao: 1, model })
    const darker = sumOf(SHADOWED, { casts: true, slot: 2, shade: 0.7, ao: 0.5, model })
    assert.ok(
      shadowed.every((v, i) => Object.is(v, darker[i])),
      `model ${model}, shadowed`,
    )
  }
})

test('a hair is lit by the specular share of a light alone: no diffuse share lights it, no specular share leaves it dark', () => {
  const hair = {
    pixelModel: PIXEL_MODEL.hair,
    modelScatter: 1,
    modelColour: [0, 0, 0],
    modelOpacity: 0,
    modelEnvironment: [0, 0, 0],
    irisMask: 0,
    irisNormal: [0, 0, 1],
    irisCaustic: [0, 0, 1],
  }
  const lit = (shares: number[]) => sumOf(UNSHADOWED, { ao: 1, shares, extra: hair })
  assert.ok(lit([0, 1]).some((v) => v > 0))
  assert.ok(lit([1, 0]).every((v) => v === 0))
  close(lit([0, 0.5]), scaled(lit([0, 1]), 0.5), 'the term is the share times the hair’s')
})
