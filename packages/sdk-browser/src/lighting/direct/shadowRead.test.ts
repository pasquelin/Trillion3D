// A rectangle light's shadow read in the loop of the opaque resolve.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { directShadowWgsl, type TranslucentMaterialShadow } from './shadowWgsl.ts'
import { shadowSliceOf } from './shadowSlice.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { F32_SCOPE } from '../shaderRunF32.fixture.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { MODEL_FLAG } from '../../materials/surface/surfaceModelWord.ts'
import { STANDARD_LIGHTING_WGSL } from '../standardLighting.ts'
import { directLightingWgsl } from './lightLoop.fixture.ts'
import { testLight } from './testLight.fixture.ts'
import { kindLane } from '../../../../sdk-core/src/scene/light/lanes.fixture.ts'

type V = number[]

/** The private variables of a module the runner leaves undeclared — no initial value —, each
 *  undefined: the loop's own state, found in its text, not listed by hand. */
const bare = (code: string) =>
  Object.fromEntries(
    [...code.matchAll(/^var<private> (\w+):[\w<>]+;/gm)].map(([, name]) => [name, undefined]),
  )

/** What the resolve lights the origin with (`sliceLighting`) from one rectangle light 3 m over it,
 *  facing down, 2 m wide, holding shadow slot 7: its shadow read answering `share`, the program with shadow code unless `unshadowed`; and the reads it made. */
function rectLit(o: {
  unshadowed?: boolean
  model?: number
  normal?: V
  thin?: boolean
  /** Half the rectangle's width, 1 by default. */
  halfWidth?: number
  shares?: V
  share: number
}) {
  const shipped = wgslModule(
    directLightingWgsl({ unshadowed: !!o.unshadowed, rectless: false, lobeless: true }),
    STANDARD_LIGHTING_WGSL,
  )
  const K = wgslConstants(shipped)
  const reads: unknown[][] = []
  const rect = testLight({
    positionRange: [0, 3, 0, 20],
    colorIntensity: [1, 1, 1, 4],
    directionCone: [0, -1, 0, -2],
    // A record with a shadow slot carries the casts flag and the dynamic shadow bits.
    params: [
      kindLane(K.KIND_RECT + K.FLAG_CASTS + (K.SHADOWED_DYNAMIC << K.SHADOWED_SHIFT)),
      7,
      0,
      0,
    ],
    shape: [o.halfWidth ?? 1, 0, 0, 0.5],
    capsule: [0, 0, ...(o.shares ?? [1, 1])],
  })
  const scope = {
    ...F32_SCOPE,
    ...K,
    ...bare(shipped),
    directLights: { count: 1, items: [rect] },
    tileLights: [],
    pixelModel: 0,
    sphereNoNewton: false,
    clearCoatBottom: false,
    thinSubsurface: o.thin ? [0.5, 0.5, 0.5] : [0, 0, 0],
    surfaceModel: o.model ?? MODEL_FLAG.diffuse,
    // The read as the shadow code answers it: no share where the surface does not face the light.
    shadowFactor: (...read: unknown[]) => (reads.push(read), read[4] ? o.share : 0),
    mat2x3f: (diffuse: V, rest: V) => [diffuse, rest],
    airTintOf: () => [1, 1, 1],
    cloudShadowOnSurface: () => 1,
  }
  const run = shaderRun<{ sliceLighting: (...a: unknown[]) => V }>(
    shipped,
    ['sliceLighting'],
    scope,
  )
  const surface = [[0.5, 0.5, 0.5], 0, 0.5, o.normal ?? [0, 1, 0], [0, 1, 0], [0, 0, 0], 1]
  return { lit: run.sliceLighting(...surface, [K.TILE_NO_SLICE, 1]), reads }
}

test('a rectangle that holds a shadow slot is its shadow’s share of the light', () => {
  const whole = rectLit({ share: 1 }).lit
  assert.ok(
    whole.every((c) => c > 0),
    `a rectangle lights the point: ${whole}`,
  )
  assert.deepEqual(
    rectLit({ share: 0.5 }).lit,
    whole.map((c) => c * 0.5),
    'half in shadow',
  )
  assert.deepEqual(rectLit({ share: 0 }).lit, [0, 0, 0], 'wholly in shadow: its exact zero')
})

test('a rectangle’s shadow is read at its slot where the surface faces it, and its normal flips for a thin back', () => {
  const facing = rectLit({ share: 0.5 })
  assert.equal(facing.reads.length, 1, 'the shadow was read')
  assert.equal(facing.reads[0][0], 7, 'at the light’s slot')
  assert.deepEqual([facing.reads[0][3], facing.reads[0][4]], [[0, 1, 0], true], 'facing it')
  // Turned away, as the projection culls it (`vsmFacesAwayFromLocal`): the read asks for no share.
  const away = rectLit({ share: 0.5, normal: [0, -1, 0] })
  assert.deepEqual([away.reads[0][3], away.reads[0][4]], [[0, -1, 0], false], 'turned away')
  assert.deepEqual(away.lit, [0, 0, 0], 'a surface turned away is not lit')
  // A thin surface turned away is lit from behind: its normal flipped, the read made.
  const back = rectLit({ share: 0.5, normal: [0, -1, 0], thin: true })
  assert.deepEqual([back.reads[0][3], back.reads[0][4]], [[0, 1, 0], true], 'thin: its back')
  assert.ok(
    back.lit.some((c) => c > 0),
    'lit from behind',
  )
  // The source radius is half the width: a normal a little past edge-on faces a wide rectangle
  // (its disk spans the horizon, `vsmFacesAwayFromLocal`) and turns away from a narrow one.
  const slant: V = [0.9539392, -0.3, 0]
  assert.equal(rectLit({ share: 1, normal: slant }).reads[0][4], true, 'a rectangle 2 m wide')
  assert.equal(rectLit({ share: 1, normal: slant, halfWidth: 0.1 }).reads[0][4], false, '0.2 m')
  // The program with no shadow code reads none and lights it whole.
  const unshadowed = rectLit({ unshadowed: true, share: 0 })
  assert.deepEqual(unshadowed.lit, rectLit({ share: 1 }).lit, 'lit whole')
  assert.equal(unshadowed.reads.length, 0)
})

test('a shadow catcher takes a rectangle’s light and the share its shadow lets through', () => {
  const caught = rectLit({ share: 0.5, model: MODEL_FLAG.shadow }).lit
  assert.ok(caught[1] > 0, 'the energy that would reach it')
  assert.equal(caught[0], caught[1] * 0.5, 'half of it, the share')
  assert.deepEqual(
    rectLit({ unshadowed: true, share: 0.5, model: MODEL_FLAG.shadow }).lit,
    [0, 0, 0],
  )
})

test('a rectangle’s share of diffuse light weighs its term and a thin back’s transmission', () => {
  for (const o of [{}, { normal: [0, -1, 0], thin: true }]) {
    const whole = rectLit({ share: 1, ...o }).lit
    assert.ok(
      whole.some((c) => c > 0),
      'lit',
    )
    // The diffuse model has no specular light: only the diffuse share counts (a power of two, exact).
    assert.deepEqual(
      rectLit({ share: 1, ...o, shares: [0.25, 0] }).lit,
      whole.map((c) => c * 0.25),
    )
  }
})

/** What a translucent fragment reads of light `channel`'s shadow under `options` and its surface's
 *  `bits` (`translucentShadowBits`): the trace's share 0.25, the one sample's 0.75, or 1 where the
 *  light is lit whole. */
function translucentRead(
  options: Parameters<typeof directShadowWgsl>[0],
  bits: number,
  channel: number,
  skipSun = false,
) {
  const text = wgslModule(directShadowWgsl(options))
  const K = wgslConstants(text)
  const { shadowFactor } = shaderRun<{ shadowFactor: (...a: unknown[]) => number }>(
    text,
    ['shadowFactor'],
    {
      ...K,
      translucentShadowBits: bits,
      shadowSkipSun: skipSun,
      vsmView: { lights: [{ kind: K.LIGHT_KIND_DIRECTIONAL }, { kind: K.LIGHT_KIND_SPOT }] },
      vsmTraceFactor: () => 0.25,
      vsmSampleFactor: () => 0.75,
    },
  )
  // Record 0 is the sun's, record 1 the spot's: the slice carries the record and the sun's flag.
  return shadowFactor(shadowSliceOf(channel, channel === 0, false), {}, [0, 0, 0], [0, 1, 0], true)
}

test('with classic shadow maps a translucent surface reads every light by the classic filter, whatever its marks and the quality say', () => {
  const [SUN, LOCAL] = [0, 1]
  for (const bits of [0, 7]) {
    assert.equal(translucentRead({ classic: true }, bits, SUN), 0.25)
    assert.equal(translucentRead({ classic: true, localShadows: true }, bits, LOCAL), 0.25)
  }
  // The program holds the classic trace and no one-sample read.
  const text = wgslModule(directShadowWgsl({ pass: 'blend', classic: true }))
  assert.ok(text.includes('vsmTraceFactor'))
  assert.ok(!text.includes('fn vsmSampleFactor('))
})

const asking = (own: Partial<TranslucentMaterialShadow>) => ({
  materials: { local: false, localTrace: false, directionalTrace: false, ...own },
})

test('a translucent surface is read by one sample, the sun alone, until its marks or the switches ask for more', () => {
  const [SUN, LOCAL] = [0, 1]
  // The defaults: the sun sampled, a local light lit whole, whatever the marks of a surface that asks nothing.
  for (const bits of [0, 7]) {
    assert.equal(translucentRead({}, bits, SUN), 0.75)
    assert.equal(translucentRead({}, bits, LOCAL), 1)
  }
  // The project's switch traces every light, a mark or not.
  for (const bits of [0, 7]) assert.equal(translucentRead({ quality: 1 }, bits, SUN), 0.25)
  assert.equal(translucentRead({ quality: 1, localShadows: true }, 0, LOCAL), 0.25)
  assert.equal(translucentRead({ localShadows: true }, 0, LOCAL), 0.75)
  // A surface asking for the sun's trace has it, and the others keep one sample.
  const sun = asking({ directionalTrace: true })
  assert.equal(translucentRead(sun, 4, SUN), 0.25)
  assert.equal(translucentRead(sun, 0, SUN), 0.75)
  assert.equal(translucentRead(sun, 4, LOCAL), 1, 'no local light shadow was asked')
  // A surface asking for the local lights' shadow has it, traced where it asks it so.
  const local = asking({ local: true, localTrace: true })
  assert.equal(translucentRead(local, 0, LOCAL), 1, 'this surface asks nothing')
  assert.equal(translucentRead(local, 1, LOCAL), 0.75)
  assert.equal(translucentRead(local, 3, LOCAL), 0.25)
  assert.equal(translucentRead(local, 2, LOCAL), 1, 'a trace of a shadow it may not have')
  assert.equal(translucentRead(local, 3, SUN), 0.75, 'the sun is not traced by the local mark')
  // Where the switch lets the local lights be shadowed, a surface asks only for the trace.
  const traced = { localShadows: true, ...asking({ localTrace: true }) }
  assert.equal(translucentRead(traced, 0, LOCAL), 0.75)
  assert.equal(translucentRead(traced, 2, LOCAL), 0.25)
})

test('a pass that reads the sun apart reads it unshadowed and leaves the local lights their shadow', () => {
  const sun = asking({ directionalTrace: true })
  assert.equal(translucentRead({ ...sun, quality: 1 }, 4, 0, true), 1)
  assert.equal(translucentRead({ ...sun, quality: 1, localShadows: true }, 4, 1, true), 0.25)
  assert.equal(translucentRead({ ...sun, quality: 1 }, 4, 0), 0.25)
})

test('the program holds the marks and the code of what its surfaces ask, and none otherwise', () => {
  const text = (options: Parameters<typeof directShadowWgsl>[0]) =>
    wgslModule(directShadowWgsl(options))
  const plain = text({})
  assert.equal(text(asking({})), plain, 'a scene that asks nothing holds the same text')
  assert.doesNotMatch(plain, /translucentShadowBits|vsmTraceFactor/)
  const both = text(asking({ directionalTrace: true }))
  assert.match(both, /var<private> translucentShadowBits:u32=0u;/)
  assert.match(both, /fn vsmTraceFactor\(/)
  assert.match(both, /fn vsmSampleFactor\(/)
  assert.equal(both.match(/\bfn vsmTraceAt\(/g)?.length, 1, 'one pixel setter beside the trace')
  const own = text(asking({ local: true }))
  assert.doesNotMatch(own, /fn vsmTraceFactor\(/)
  assert.match(own, /LIGHT_KIND_DIRECTIONAL/)
})
