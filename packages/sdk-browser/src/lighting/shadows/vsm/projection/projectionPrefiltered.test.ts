// The suns' projection of the prefiltered distant shadow (`projectionPrefilteredWgsl.ts`,
// `projectionEntryWgsl.ts`), run as the shipped text: the merged pool sampled at the biased point
// one level coarser than the receiver's distance asks, the receiver shadowed whole not traced, the
// product and the occluder distance of the two; and a set without the feature compiles what it did.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { storageBufferCount } from '../../../../gpu/core/stageLimits.fixture.ts'
import { wgslComputeLayout } from '../../../../gpu/core/wgslBindings.fixture.ts'
import { shaderRun } from '../../../../materials/texture/shaderRun.fixture.ts'
import { Mat } from '../../../../materials/texture/shaderRunMatrix.fixture.ts'
import { VSM_UNIT_PER_CM } from '../constants.ts'
import { filterableWorld, orthoMap } from '../filterableWorld.fixture.ts'
import { MAPS, OFF, ON } from '../prefiltered.fixture.ts'
import { vsmLayout } from '../layout.ts'
import { VSM_MAP_LEVEL_INDEX_SHIFT, VSM_MAP_PREFILTERED_DISTANT } from '../prefilteredConstants.ts'
import { vsmSunsEntryWgsl } from './projectionEntryWgsl.ts'
import { pipelinesFor } from './projectionPipelines.ts'
import { vsmLocalsProjectionWgsl, vsmSunsProjectionWgsl } from './projectionWgsl.ts'

const CODE = vsmSunsProjectionWgsl(ON)

test('off, the suns’ pass is the text it was: no merged pool, no sample, the trace of each sun alone', () => {
  const text = vsmSunsProjectionWgsl(OFF)
  assert.doesNotMatch(text, /vsmFilterable|vsmPrefiltered|VSM_FILTER|VSM_MAP_PREFILTERED/)
  assert.doesNotMatch(text, /vsmEntrySecondary/)
  assert.equal(vsmSunsEntryWgsl(false), vsmSunsEntryWgsl())
  assert.ok(
    text.includes(` for(var k=0u;k<vsmView.sunCount;k++){
  let inLight=vsmLightParticipates(k,pixel.info,pixel.shifted);
  let own=vsmTraceLight(vsmView.lights[k],pixel,receiver,inLight);
  let r=vsmSubsurfaceShadow(vsmFirstPersonTrace(own,k,pixel,receiver,inLight),pixel.info);
  if(pixel.inRect){textureStore(vsmSunMask,pixel.pos,k,vec4f(select(1.0,r.shadowFactor,r.rayCount>0u)));}
 }`),
  )
  // The local lights’ pass is the same text with the feature or without.
  assert.equal(vsmLocalsProjectionWgsl(ON, 'rg32uint'), vsmLocalsProjectionWgsl(OFF, 'rg32uint'))
})

test('on, each sun is sampled at the receiver’s biased point before its trace, and a receiver shadowed whole is not traced', () => {
  const entry = vsmSunsEntryWgsl(true)
  // `receiver.P` is the point pushed along the normal by the bias (`vsmReceiverOf`).
  assert.match(entry, /vsmPrefilteredSample\(vsmView\.lights\[k\],receiver\.P,inLight\)/)
  // The trace's `participating` is false for a lane shadowed whole: it votes neutrally, traces nothing.
  const traced = /vsmTraceLight\(vsmView\.lights\[k\],pixel,receiver,inLight&&!vsmPrefilteredWhole/
  assert.match(entry, traced)
  // The first-person pass then reads the combined result.
  assert.match(entry, /vsmFirstPersonTrace\(own,k,pixel,receiver,inLight\)/)
  assert.match(CODE, /@binding\(6\) var<storage,read> vsmFilterableMerged/)
})

const storageBuffers = (code: string) => storageBufferCount(wgslComputeLayout(code))

test('the suns’ pass binds the merged pool in its own group: six storage buffers, the locals’ pass eight as ever', () => {
  assert.equal(storageBuffers(vsmSunsProjectionWgsl(OFF)), 5)
  assert.equal(storageBuffers(CODE), 6)
  assert.equal(storageBuffers(vsmLocalsProjectionWgsl(ON, 'rg32uint')), 8)
})

test('a set that holds the feature has its own projection pipelines, its suns’ group one binding more', () => {
  const { device } = fakeDevice()
  const [off, on] = [pipelinesFor(device, OFF), pipelinesFor(device, ON)]
  assert.notEqual(on, off)
  assert.equal(pipelinesFor(device, vsmLayout(MAPS)), off, 'a like set shares its pipelines')
  const bindings = (p: typeof off) =>
    (p.sunsLayout as unknown as { entries: { binding: number }[] }).entries.map((e) => e.binding)
  assert.equal(bindings(off).includes(6), false)
  assert.equal(bindings(on).includes(6), true)
  assert.deepEqual(
    bindings(on).filter((b) => !bindings(off).includes(b)),
    [6],
  )
})

/** Maps 0 to 2 of a sun’s clipmap (levels 10 to 12, three levels left of the first), the merged page of
 *  the second at (64, 64) bytes `merged(x, y)`, mapped as a secondary request where asked. */
function sunWorld(merged: (x: number, y: number) => number, secondary = true) {
  const w = filterableWorld()
  const flags = VSM_MAP_PREFILTERED_DISTANT
  w.addMap(0, { flags, mapLevel: 10, levelsLeft: 3 })
  w.addMap(1, { flags: flags | (1 << VSM_MAP_LEVEL_INDEX_SHIFT), mapLevel: 11, levelsLeft: 2 })
  w.addMap(2, { flags: flags | (2 << VSM_MAP_LEVEL_INDEX_SHIFT), mapLevel: 12, levelsLeft: 1 })
  w.addPage(4, 1, [64, 64], { secondary })
  for (let y = 0; y < 130; y++)
    for (let x = 0; x < 130; x++) w.setByte(w.world.vsmFilterableMerged, 4, x, y, merged(x, y))
  const scope = {
    ...w.consts,
    ...w.world,
    vsmView: { originShiftHigh: [0, 0, 0], originShiftLow: [0, 0, 0] },
  }
  const names = ['vsmPrefilteredSample', 'vsmPrefilteredWhole', 'vsmPrefilteredCombine']
  const run = shaderRun<{
    vsmPrefilteredSample: (light: object, p: number[], participating: boolean) => Sample
    vsmPrefilteredWhole: (s: Sample) => boolean
    vsmPrefilteredCombine: (s: Sample, traced: Traced) => Traced
  }>(CODE, names, scope)
  return { w, run }
}
interface Sample {
  valid: boolean
  factor: number
  occluderDistance: number
}
interface Traced {
  shadowFactor: number
  rayCount: number
  occluderDistance: number
}
const LIGHT = { mapId: 0 }
/** A point 14.1 m out: level 10.5 of the clipmap, whose first level is 10: the level index 1 is read. */
const POINT = [10, 10, 0]

test('the sample reads the merged pool one level below the one the distance asks, bilinear at the point’s texel', () => {
  const { run } = sunWorld((x) => x)
  const s = run.vsmPrefilteredSample(LIGHT, POINT, true)
  // The point is the texel 10 of the page: the read is between the bytes 10 and 11 of the ramp, a half each.
  assert.equal(s.valid, true)
  assert.ok(Math.abs(s.factor - 10.5 / 255) < 1e-12, `${s.factor}`)
  // The depth range [0.5, 1] of the level, its view depth the clip depth negated: 0.5 apart.
  assert.equal(s.occluderDistance, 0.5)
})

test('the occluder distance is never under a millionth of a centimetre', () => {
  const { w, run } = sunWorld((x) => x)
  const level = w.world.vsmProjectionData[1] as { dynamicDepthCullRange: number[] }
  level.dynamicDepthCullRange = [1, 0.5]
  const { occluderDistance } = run.vsmPrefilteredSample(LIGHT, POINT, true)
  assert.equal(occluderDistance, 1e-6 * VSM_UNIT_PER_CM)
})

test('a page that is no secondary request is lit by no value: valid, and a factor of 0', () => {
  const s = sunWorld(() => 255, false).run.vsmPrefilteredSample(LIGHT, POINT, true)
  assert.deepEqual([s.valid, s.factor], [true, 0])
})

test('no sample where the lane is out, the clipmap holds none, the level is past its last or the point is outside the map', () => {
  const { w, run } = sunWorld(() => 255)
  assert.equal(run.vsmPrefilteredSample(LIGHT, POINT, false).valid, false, 'not participating')
  const far = run.vsmPrefilteredSample(LIGHT, [1000, 0, 0], true)
  assert.equal(far.valid, false, 'past the last level')
  const records = w.world.vsmProjectionData as { shiftedToMapUv: Mat; flags: number }[]
  records[1].shiftedToMapUv = new Mat(orthoMap().m.map((x, i) => (i === 12 ? 2 : x)))
  assert.equal(run.vsmPrefilteredSample(LIGHT, POINT, true).valid, false, 'outside the map')
  records[1].shiftedToMapUv = orthoMap()
  assert.equal(run.vsmPrefilteredSample(LIGHT, POINT, true).valid, true, 'inside again')
  records[0].flags = 0
  assert.equal(run.vsmPrefilteredSample(LIGHT, POINT, true).valid, false, 'no prefiltered clipmap')
})

test('a factor under a hundred-millionth is 0: a byte a hair’s breadth from the point is nothing', () => {
  // The byte 11 is a 255th, the byte 10 none; the point a billionth of a texel past the centre of 10.
  const { run } = sunWorld((x) => (x === 11 ? 1 : 0))
  const s = run.vsmPrefilteredSample(LIGHT, [9.5 + 2e-9, 10, 0], true)
  assert.equal(s.factor, 0)
})

test('a receiver is shadowed whole at a factor of a ten-thousandth or less, a valid sample', () => {
  const { run } = sunWorld(() => 0)
  const sample = (valid: boolean, factor: number): Sample => ({
    ...{ valid, factor },
    occluderDistance: 1,
  })
  assert.equal(run.vsmPrefilteredWhole(sample(true, 0.0001)), true)
  assert.equal(run.vsmPrefilteredWhole(sample(true, 0.00011)), false)
  assert.equal(run.vsmPrefilteredWhole(sample(true, 0)), true)
  assert.equal(run.vsmPrefilteredWhole(sample(false, 0)), false)
})

test('the combination: the product of the shares; the occluder distance mixed by the sample’s share', () => {
  const { run } = sunWorld(() => 0)
  const sample: Sample = { valid: true, factor: 0.5, occluderDistance: 4 }
  // A trace that shadows part: the product, the traced rays kept, the distance between the two.
  assert.deepEqual(
    run.vsmPrefilteredCombine(sample, { shadowFactor: 0.25, rayCount: 3, occluderDistance: 2 }),
    { shadowFactor: 0.125, rayCount: 3, occluderDistance: 3 },
  )
  // The distance leans on the trace’s as the sample lightens, on the sample’s as it darkens.
  const dark = { ...sample, factor: 0.25 }
  const hit = { shadowFactor: 0.5, rayCount: 1, occluderDistance: 2 }
  assert.equal(run.vsmPrefilteredCombine(dark, hit).occluderDistance, 4 * 0.75 + 2 * 0.25)
  // A trace that shadows nothing (it reports a distance of 0 for no hit): the sample’s distance.
  assert.deepEqual(
    run.vsmPrefilteredCombine(sample, { shadowFactor: 1, rayCount: 2, occluderDistance: 0 }),
    { shadowFactor: 0.5, rayCount: 2, occluderDistance: 4 },
  )
  // No trace (the lane shadowed whole): the sample alone, counted as a ray traced.
  assert.deepEqual(
    run.vsmPrefilteredCombine(sample, { shadowFactor: 1, rayCount: 0, occluderDistance: -1 }),
    { shadowFactor: 0.5, rayCount: 1, occluderDistance: 4 },
  )
  // No sample: the trace as it is.
  const traced = { shadowFactor: 0.3, rayCount: 4, occluderDistance: 1 }
  assert.deepEqual(run.vsmPrefilteredCombine({ ...sample, valid: false }, traced), traced)
})
