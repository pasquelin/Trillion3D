// The view's cloud trace programs as shipped, run in JavaScript (`shaderRun`) or read as text: the
// order a march reads a point in (the material's conservative density before the rest of the
// material), and the cloud's own shade read from the clouds' shadow maps where the material does
// not march it.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import { SKY_QUALITY_RULES } from '../../../../../sdk-core/src/modules/sky/quality.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { cloudSetupOf } from './cloudModes.ts'
import { CLOUD_SHADOW_TRACE_PROGRAM } from './shadowWgsl.ts'
import { cloudTraceProgram } from './traceWgsl.ts'
import {
  captureCloudKey,
  cloudTraceExtraLayoutEntries,
  cloudTraceHasExtra,
  cloudTraceKey,
  cloudTraceKeyText,
  type CloudTraceKey,
} from './traceExtraLayout.ts'

const KEY: CloudTraceKey = {
  depth: 'scene',
  minMaxDepth: false,
  emptySpace: false,
  opaqueShadow: false,
  localLights: false,
  skyLight: false,
  volumeShadowMap: false,
  closestDepth: false,
}
const FROM_MAP: CloudTraceKey = { ...KEY, volumeShadowMap: true }

/** The probe and the material of a world where a medium (an extinction of 1) fills the points past
 *  `from` centimetres along x, and the number of full material reads asked of it. */
function counted(from: number) {
  const reads = { probes: 0, points: 0 }
  return {
    reads,
    stubs: {
      cloudProbeAt: (at: number[]) => (reads.probes++, { at, norm: 0.5 }),
      cloudProbeDense: (probe: { at: number[] }) => probe.at[0] >= from,
      cloudPointOf: () => (reads.points++, { spot: { extinction: [1, 1, 1] }, norm: 0.5 }),
    },
  }
}

/** The march of a shadow ray (`cloudShadow`) of two samples, at 125 and at 625 centimetres along x,
 *  over a material whose density bound is above 0 from `from` on. */
function shadowRun(from: number) {
  const world = counted(from)
  const { cloudShadow } = shaderRun<{
    cloudShadow: (rel: number[], toward: number[], o: object) => number[][]
  }>(cloudTraceProgram(KEY), ['cloudShadow'], {
    cloudTrace: { samples: [0, 0, 1000, 0] },
    cloudShadowEach: 0.5,
    ...world.stubs,
  })
  const through = cloudShadow([0, 0, 0], [1, 0, 0], {
    count: 1,
    extinction: [1, 1, 1],
  })
  return { reads: world.reads, through }
}

test('a shadow ray reads the material of the samples whose density bound is above 0 alone', () => {
  const empty = shadowRun(10000)
  assert.deepEqual(empty.reads, { probes: 2, points: 0 }, 'empty air: two probes, no material')
  assert.deepEqual(empty.through[0], [1, 1, 1])
  const partly = shadowRun(300)
  assert.deepEqual(partly.reads, { probes: 2, points: 1 }, 'the second sample only is read')
  // The second sample's segment is 0.75 of the ray (a sample spread by its square), 1000 cm long.
  assert.ok(Math.abs(partly.through[0][0] - Math.exp(-0.75 * 10)) < 1e-6)
})

test('the ground bounce reads the material of the samples whose density bound is above 0 alone', () => {
  const run = (from: number) => {
    const world = counted(from)
    const { cloudGroundLight } = shaderRun<{
      cloudGroundLight: (rel: number[], air: number[][], lights: object) => number[]
    }>(cloudTraceProgram(KEY), ['cloudGroundLight'], {
      cloudTrace: { counts: [0, 0, 0, 1], ground: [0.4, 0.4, 0.4, 0] },
      PI: Math.PI,
      cloudPlanetEye: [0, 0, 636000100],
      cloudBottomCm: 636000000,
      ...world.stubs,
    })
    const lights = { count: 1, list: [{ raw: [1, 1, 1], toward: [0, 0, 1] }] }
    cloudGroundLight(
      [0, 0, 0],
      [
        [1, 1, 1],
        [1, 1, 1],
      ],
      lights,
    )
    return world.reads
  }
  assert.deepEqual(run(Infinity), { probes: 5, points: 0 }, 'empty air: five probes, no material')
  assert.deepEqual(run(-Infinity), { probes: 5, points: 5 }, 'a full medium: every sample is read')
})

test('the shadow map pass reads the material of the samples whose density bound is above 0 alone', () => {
  const run = (from: number) => {
    const world = counted(from)
    const { shadowTrace } = shaderRun<{ shadowTrace: (p: number[]) => number[] }>(
      CLOUD_SHADOW_TRACE_PROGRAM.code,
      ['shadowTrace'],
      {
        cloudShadow: { ray: [0, 0, 0, 10], output: [1, 0, 4, 0] },
        shadowRay: () => ({ near: [0, 0, 0], tMin: 0, span: 1000, status: 0 }),
        shadowPartner: () => ({ ray: {}, sign: 1 }),
        shadowFootprint: () => undefined,
        shadowSpot: (_: object, along: number) => [along * 1000, 0, 0],
        ...world.stubs,
      },
    )
    shadowTrace([0, 0])
    return world.reads
  }
  assert.deepEqual(run(Infinity), { probes: 4, points: 0 }, 'empty air: four probes, no material')
  assert.deepEqual(run(-Infinity), { probes: 4, points: 4 })
})

/** The text of the function `name` of a program: from its header to the next top-level function. */
const functionText = (code: string, name: string) => {
  const from = code.indexOf(`fn ${name}(`)
  const to = code.indexOf('\nfn ', from + 1)
  return code.slice(from, to < 0 ? undefined : to)
}

test('the view march probes a point, skips it where its density bound is zero, and reads the rest after', () => {
  const march = functionText(cloudTraceProgram(KEY), 'cloudMarch')
  const at = (word: string) => march.indexOf(word)
  assert.ok(at('cloudProbeAt(') > 0 && at('cloudProbeDense(') > at('cloudProbeAt('))
  assert.ok(at('cloudPointOf(') > at('cloudProbeDense('), 'the material after the density bound')
  assert.ok(at('cloudPointOf(') > at('probe.norm<=0.0'), 'and after the altitude test')
  assert.ok(!march.includes('cloudPointAt('), 'no read of the whole material at a point')
})

test('the layout’s texture gradients of a point are worked out once, by its site, and the material reads them from it', () => {
  const code = cloudTraceProgram(KEY)
  const worked = (name: string) => functionText(code, name).split('cloudLayoutGrad(').length - 1
  assert.ok(code.includes('struct CloudSite{place:vec3f,pattern:vec4f,gx:vec2f,gy:vec2f,}'))
  assert.equal(worked('cloudSiteAt'), 2, 'the site: one for each screen axis')
  for (const name of ['cloudMaterialAt', 'cloudLightning', 'cloudStormEmissive'])
    assert.equal(worked(name), 0, `${name} reads the site’s`)
})

test('the default program marches the cloud’s shadow toward each light and binds no shadow map', () => {
  const code = cloudTraceProgram(KEY)
  assert.ok(code.includes('let shadow=cloudShadow(rel,lights.list[k].toward,o);'))
  assert.ok(code.includes('fn cloudShadow(rel:vec3f,toward:vec3f,o:CloudOctaves)'))
  assert.ok(!code.includes('cloudMapShadow') && !code.includes('cloudShadowBlock'))
  assert.equal(cloudTraceHasExtra(KEY), false, 'no group 2 for the plain program')
})

test('a material that does not march its shadow reads the maps of the lights: nothing is marched', () => {
  const code = cloudTraceProgram(FROM_MAP)
  assert.ok(code.includes('let shadow=cloudMapShadow(rel,k,o);'))
  assert.ok(!code.includes('cloudShadow(rel'), 'no march toward a light')
  assert.ok(!code.includes('fn cloudShadow('), 'and none declared')
  assert.ok(code.includes('@group(2) @binding(9) var<uniform> cloudShadowBlock:CloudShadowBlock;'))
  assert.ok(code.includes('fn cloudShadowDepth(k:u32,P:vec3f)->f32{'))
  assert.deepEqual(
    cloudTraceExtraLayoutEntries(FROM_MAP).map((entry) => entry.binding),
    [9, 10, 11, 12],
    'the block, the two maps and their sampler, in group 2',
  )
  assert.notEqual(cloudTraceKeyText(KEY), cloudTraceKeyText(FROM_MAP), 'a program of its own')
})

test('the shade read from a map is exp(-d) for the first order and exp(-d e^n) for the order n', () => {
  const { cloudMapShadow } = shaderRun<{
    cloudMapShadow: (rel: number[], k: number, o: { count: number }) => number[][]
  }>(cloudTraceProgram(FROM_MAP), ['cloudMapShadow'], {
    cloudOrigin: [0, 0, 0],
    cloudMaterial: { multiScatter: [0.6, 0.25, 0.18, 2] },
    // The optical depth of light 1's map at the point, 100 m from the eye along x.
    cloudShadowDepth: (k: number, p: number[]) => (k === 1 && p[0] === 100 ? 0.8 : 0),
  })
  const through = cloudMapShadow([10000, 0, 0], 1, { count: 3 })
  assert.deepEqual(
    through.map((order) => order[0]),
    [Math.exp(-0.8), Math.exp(-0.8 * 0.25), Math.exp(-0.8 * 0.25 ** 2)],
  )
  assert.deepEqual(cloudMapShadow([10000, 0, 0], 0, { count: 3 })[2], [1, 1, 1], 'light 0: none')
})

const QUALITY = resolveSettings(SKY_QUALITY_RULES, {})
const MARCHED = { rayMarchVolumeShadow: true }
const SEEN = { reflection: false, skyCapture: false, sunShadowsOnClouds: false, airless: false }

test('the view reads the sky light’s harmonics only in a scene with no air, and only with the distant sky light on', () => {
  const setup = cloudSetupOf(QUALITY)
  const key = (airless: boolean, quality = QUALITY) =>
    cloudTraceKey(quality, { ...SEEN, airless }, setup, MARCHED).skyLight
  assert.deepEqual([key(false), key(true)], [false, true])
  assert.equal(key(true, { ...QUALITY, cloudDistantSkyLight: false }), false)
})

test('the capture’s key has the sun’s shadow where it is shadowed, the harmonics where there is no air, never the lamps', () => {
  // The lamps are on in the quality settings, and still no lamp lights a capture.
  const key = (shadowed: boolean, airless: boolean) =>
    captureCloudKey({ ...QUALITY, cloudLocalLights: true }, shadowed, airless, MARCHED)
  for (const shadowed of [false, true])
    for (const airless of [false, true]) {
      const made = key(shadowed, airless)
      assert.deepEqual(
        [made.opaqueShadow, made.skyLight, made.localLights, made.emptySpace],
        [shadowed, airless, false, false],
        `shadowed ${shadowed}, airless ${airless}`,
      )
    }
  assert.equal(
    captureCloudKey(QUALITY, false, false, { rayMarchVolumeShadow: false }).volumeShadowMap,
    true,
  )
  assert.equal(key(false, false).volumeShadowMap, false, 'the default marches')
})

test('the trace writes the closest surface’s depth only where the haze is laid per pixel over two surfaces', () => {
  const two = { ...cloudSetupOf(QUALITY), minMaxDepth: true },
    one = { ...two, minMaxDepth: false }
  const key = (setup = two, frame = SEEN, quality = QUALITY) =>
    cloudTraceKey(quality, frame, setup, MARCHED).closestDepth
  const hazed = { ...QUALITY, cloudHighQualityAerial: true, cloudAerialPerspective: true }
  assert.equal(key(two, SEEN, hazed), true)
  assert.equal(key(), false, 'the haze is traced by the trace by default')
  assert.equal(key(one), false, 'one surface')
  assert.equal(key(two, { ...SEEN, airless: true }), false, 'no air to scatter the haze')
  assert.equal(key(two, { ...SEEN, skyCapture: true }), false, 'a capture lays its own')
  assert.equal(key(two, SEEN, { ...QUALITY, cloudHighQualityAerial: false }), false)
})
