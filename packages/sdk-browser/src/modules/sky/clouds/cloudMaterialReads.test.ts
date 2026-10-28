// The cloud material reads the channels it weighs and no others: the storm's pattern channel and
// profile only under a storm, the mask only where it weighs a type. Run as shipped (`shaderRun`, in
// doubles, finite inputs), against the same text with its conditions forced on, every value is the
// same where a condition is off — nothing weighed what it skipped — and the reads are the ones the
// conditions leave; where it is on, the read changes the result.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { CLOUD_MATERIAL_WGSL, cloudMaterialBindings } from './materialWgsl.ts'

const SOURCE = wgslSource(wgslProgram(cloudMaterialBindings(0, 0), [CLOUD_MATERIAL_WGSL]))
const CONDITIONS = [
  'if(m.storm.x!=0.0)',
  'if(storm!=0.0)',
  'if(any(m.maskTypeWeights.xyz!=vec3f(0.0)))',
]
/** The program with every one of its conditions true: what it read and computed before they were. */
const ALWAYS = CONDITIONS.reduce((text, condition) => {
  assert.ok(text.includes(condition), `the shipped text holds ${condition}`)
  return text.replace(condition, 'if(true)')
}, SOURCE)

/** Four channels per texture, each a function of the coordinates so that no two reads agree. */
const channel = (uv: number[], k: number) =>
  0.2 + 0.5 * Math.abs(Math.sin(uv[0] * 3.1 + uv[1] * 1.7 + k))

/** The material block: `storm` the storm amount, `mask` the mask's type weights. */
const block = (storm: number, mask: number[]) => ({
  coverageDensity: [2, 0.1, 0.4, 0],
  placement: [0.01, 0.02, 0.03, 0.4],
  typeWeights: [1, 0.8, 0.6, 0.9],
  typePatternScale: [1, 1.3, 1.7, 2.1],
  maskTypeWeights: [...mask, 1],
  wind: [0.1, 0.2, 0, 0.5],
  erosionNoise: [3, 3, 3, 0.1],
  distortionNoise: [2, 2, 2, 0.1],
  noiseBias: [0.4, 0.5, 0.45, 0],
  noiseStrength: [0.8, 0.6, 0.3, 1.5],
  detailNoise: [9, 9, 9, 0.2],
  detailNoiseMultiplier: [0.3, 0.2, 0.1, 0.9],
  albedoOcclusion: [0.8, 0.82, 0.85, 0.7],
  stormAlbedo: [0.3, 0.32, 0.35, 0.6],
  storm: [storm, 4, 1, 0],
  lightningColor: [1, 0.9, 0.8, 2],
  lightningSource: [2, 0.5, 0.3, 1],
  lightningMasks: [0.2, 3, 0.5, 0],
  lightningAnimation: [1, 0.1, 0.2, 0],
})

function run(text: string, material: object, shift = (c: number) => c) {
  const reads = { pattern: 0, profile: 0, mask: 0 }
  const texture = (k: number) => ({ k })
  const scope = {
    cloudMaterial: material,
    noiseVolume: texture(0),
    layoutPattern: texture(1),
    heightProfile: texture(2),
    globalMask: texture(3),
    lightningVolume: texture(4),
    cloudSampler: {},
    // The footprint of the sample, as a march sets it.
    cloudDdx: [120, 30, 5],
    cloudDdy: [-20, 90, 8],
    cloudLayoutTileCm: 0,
    cloudTurn: [1, 0],
    cloudDrift: [0, 0, 0],
    textureDimensions: () => [64, 64],
    textureSampleGrad: (t: { k: number }, _s: unknown, uv: number[]) => {
      if (t.k === 1) reads.pattern++
      if (t.k === 3) reads.mask++
      return [0, 1, 2, 3].map((c) => shift(channel(uv, t.k * 4 + c)))
    },
    textureSampleLevel: (t: { k: number }, _s: unknown, uv: number[]) => {
      if (t.k === 2) reads.profile++
      return [0, 1, 2, 3].map((c) => channel(uv, t.k * 4 + c))
    },
  }
  const { cloudMaterialStart, cloudSiteAt, cloudMaterialAt, cloudConservativeDensity } = shaderRun<{
    cloudMaterialStart: (time: number) => void
    cloudSiteAt: (world: number[]) => { pattern: number[] }
    cloudMaterialAt: (a: number, rel: number[], time: number, l: object) => object
    cloudConservativeDensity: (l: object) => number
  }>(
    text,
    ['cloudMaterialStart', 'cloudSiteAt', 'cloudMaterialAt', 'cloudConservativeDensity'],
    scope,
  )
  cloudMaterialStart(3)
  const site = cloudSiteAt([1234, 5678, 90])
  const density = cloudConservativeDensity(site)
  const sample = cloudMaterialAt(0.4, [20000, 10000, 5000], 3, site)
  return { density, sample, reads }
}

for (const storm of [0, 0.6])
  for (const mask of [
    [0, 0, 0],
    [0, 0.5, 0],
  ])
    test(`storm ${storm}, mask ${mask}: the same density and material as with every read, and only the reads the conditions leave`, () => {
      const material = block(storm, mask)
      const shipped = run(SOURCE, material)
      const all = run(ALWAYS, material)
      assert.deepEqual(shipped.density, all.density)
      assert.deepEqual(shipped.sample, all.sample)
      const { extinction } = shipped.sample as { extinction: number[] }
      assert.ok(
        extinction[0] > 0 && extinction[0] < 1,
        `a cloud the test can tell: ${extinction[0]}`,
      )
      assert.ok(Number.isFinite(shipped.density))
      assert.equal(all.reads.mask, 1)
      assert.equal(shipped.reads.mask, mask.some((w) => w !== 0) ? 1 : 0, 'the mask')
      // The pattern: three channels always, the fourth under a storm; the profile likewise.
      assert.equal(shipped.reads.pattern, storm ? 4 : 3, 'the pattern')
      assert.equal(shipped.reads.profile, storm ? 4 : 3, 'the profile')
    })

test('where a condition is on, the read matters: the storm channel and the mask each move the result', () => {
  const base = run(SOURCE, block(0.6, [0, 0, 0]))
  const stormy = run(SOURCE, block(0.6, [0, 0, 0]), (c) => c + 0.1)
  assert.notDeepEqual(stormy.sample, base.sample, 'the storm’s pattern and profile')
  assert.notEqual(stormy.density, base.density)
  const calm = run(SOURCE, block(0, [0, 0, 0]))
  const masked = run(SOURCE, block(0, [0, 0.5, 0]))
  assert.notDeepEqual(masked.sample, calm.sample, 'the mask')
})
