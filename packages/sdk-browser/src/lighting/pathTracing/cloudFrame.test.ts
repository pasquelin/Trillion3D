// The clouds the paths trace, from the sky's word to the block the programs read: the clip frame about the eye, the layer, the march's reach, the cutoff and the flags.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { CloudPart } from '../../../../sdk-core/src/modules/sky/clouds.ts'
import {
  ATMOSPHERE_SLOT,
  ATMOSPHERE_SLOTS,
} from '../../../../sdk-core/src/scene/core/atmospherePack.ts'
import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { PT_CLOUD_FLAG } from './cloudMediumWgsl.ts'
import {
  admitCloudMap,
  cloudRefusalHolds,
  cloudShadowLightsOf,
  cloudsAtTime,
  cloudUniform,
  cloudResources,
  cloudsKey,
  grantsPathTracedClouds,
  PT_CLOUD_FINISH_TEXTURES,
  type PathTracingCloudSettings,
  type PathTracingClouds,
} from './cloudFrame.ts'
import { finishLayoutEntries } from './pipelines.ts'

const settings: PathTracingCloudSettings = {
  pathTracingEnableReferenceClouds: true,
  pathTracingCloudAccelerationMapResolution: 512,
  pathTracingCloudAccelerationMapNumSamples: 64,
  pathTracingCloudAccelerationMapVisualize: false,
  pathTracingCloudMultipleScatterMode: 1,
  pathTracingCloudRoughnessCutoff: 0.05,
}
const layer = {
  baseAltitudeKm: 5,
  thicknessKm: 10,
  farthestEntryKm: 350,
  marchLengthFrom: 'layerEntry',
  marchLengthKm: 50,
  inMainView: true,
}
const cloudsOf = (over: Partial<typeof layer> = {}): PathTracingClouds => ({
  part: { settings: { ...layer, ...over } } as unknown as CloudPart,
  entries: [],
  time: 7,
})
// The air's block: a planet of 6360 km whose top stands at (100, 200) on a ground at 3 m.
const packed = new Float32Array(ATMOSPHERE_SLOTS * 4)
packed.set([1, 6360, 6460, 3], ATMOSPHERE_SLOT.planet * 4)
packed.set([100, 200], ATMOSPHERE_SLOT.planetPlace * 4)
const eye = [100, 1003, 200] as const
const uniform = (c = cloudsOf(), s: Partial<PathTracingCloudSettings> = {}, iteration = 0) => {
  const floats = cloudUniform(c, { ...settings, ...s }, packed, eye, iteration)
  return { floats, words: new Uint32Array(floats.buffer) }
}

test('the clip frame is orthonormal with its up from the planet’s centre to the eye, and the eye rides in the axes’ fourth lanes', () => {
  const { floats } = uniform()
  const axis = (at: number) => [floats[at]!, floats[at + 1]!, floats[at + 2]!]
  const [x, y, z] = [axis(0), axis(4), axis(8)]
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!
  for (const a of [x, y, z]) assert.ok(Math.abs(dot(a, a) - 1) < 1e-6)
  assert.ok(Math.abs(dot(x, y)) < 1e-6 && Math.abs(dot(x, z)) < 1e-6 && Math.abs(dot(y, z)) < 1e-6)
  assert.ok(Math.abs(z[1]! - 1) < 1e-6, 'the eye stands above the planet’s top')
  assert.deepEqual([floats[3], floats[7], floats[11]], [100, 1003, 200])
})

test('the planet’s centre is below the top of the ground plane by the radius, with the time after it, and the eye’s distance from it in kilometres', () => {
  const { floats } = uniform()
  assert.deepEqual([...floats.slice(12, 16)], [100, 3 - 6360000, 200, 7])
  assert.ok(Math.abs(floats[19]! - (6360000 + 1000) / 1000) < 1e-3)
})

test('the layer is the planet’s radius plus the base altitude, over the thickness; the clip box is the farthest entry within the top', () => {
  const { floats } = uniform()
  assert.deepEqual([...floats.slice(16, 18)], [6365, 6375])
  assert.equal(floats[18], 350)
  assert.equal(uniform(cloudsOf({ farthestEntryKm: 1e6 })).floats[18], 6375)
})

test('the march reach is the part’s from the layer’s entry, else the clip box’s diagonal from the eye, over a texel the map’s width', () => {
  const entry = uniform().floats
  assert.equal(entry[20], 50000)
  assert.ok(Math.abs(entry[21]! - (2 * 350 * 1000) / 512) < 1e-3)
  assert.ok(Math.abs(entry[22]! * entry[21]! - 1) < 1e-6)
  const eyeMode = uniform(cloudsOf({ marchLengthFrom: 'eye' })).floats
  assert.equal(eyeMode[18], 50)
  assert.equal(eyeMode[20], 2 * 50 * 1000)
})

test('the roughness cutoff is the setting, lifted to one when multiple scattering is left to the paths', () => {
  assert.ok(Math.abs(uniform().floats[23]! - 0.05) < 1e-7)
  assert.equal(uniform(cloudsOf(), { pathTracingCloudMultipleScatterMode: 2 }).floats[23], 1)
  assert.ok(
    Math.abs(uniform(cloudsOf(), { pathTracingCloudMultipleScatterMode: 0 }).floats[23]! - 0.05) <
      1e-7,
  )
  assert.equal(
    uniform(cloudsOf(), {
      pathTracingCloudMultipleScatterMode: 2,
      pathTracingCloudRoughnessCutoff: 0,
    }).floats[23],
    0,
  )
})

test('the options hold the map’s side, the flags, the samples and the sample the run is at; the approximation is on in mode 1 alone and never over the map’s view', () => {
  const on = uniform(cloudsOf(), {}, 3).words
  assert.deepEqual(
    [...on.slice(24, 28)],
    [512, PT_CLOUD_FLAG.on | PT_CLOUD_FLAG.approximate, 64, 3],
  )
  assert.equal(
    uniform(cloudsOf(), { pathTracingCloudMultipleScatterMode: 0 }).words[25],
    PT_CLOUD_FLAG.on,
  )
  assert.equal(
    uniform(cloudsOf(), { pathTracingCloudMultipleScatterMode: 2 }).words[25],
    PT_CLOUD_FLAG.on,
  )
  assert.equal(
    uniform(cloudsOf(), { pathTracingCloudAccelerationMapVisualize: true }).words[25],
    PT_CLOUD_FLAG.on | PT_CLOUD_FLAG.visualize,
  )
})

test('a clouds part has one number, the same each time, another for another part; none is none', () => {
  const a = cloudsOf()
  const b = cloudsOf()
  assert.equal(cloudsKey(a), cloudsKey(a))
  assert.notEqual(cloudsKey(a), cloudsKey(b))
  assert.equal(cloudsKey(undefined), 'none')
})

test('the key of a part and its entries is made once, and the run holds one time for the clouds', () => {
  const a = cloudsOf()
  const key = cloudsKey(a)
  assert.equal(cloudsKey({ ...a, time: 99 }), key)
  assert.equal(cloudsAtTime(a, a.time), a)
  assert.equal(cloudsAtTime(a, undefined), a)
  assert.equal(cloudsAtTime(a, 7)?.time, 7)
  assert.equal(cloudsAtTime(undefined, 7), undefined)
  assert.equal(cloudsKey(cloudsAtTime(a, 7)), key)
})

test('the resources of the clouds’ bindings are one list for each map of the pair, kept from image to image', () => {
  const a = cloudsOf()
  const views = [{}, {}]
  const cloud = {}
  const gpu = {
    cloud,
    cloudMapViews: views,
    cloudNames: views.map((view) => [cloud, view]),
    cloudNamesOf: undefined,
    cloudWritten: 0,
  } as never as Parameters<typeof cloudResources>[0]
  const first = cloudResources(gpu, a)
  assert.equal(cloudResources(gpu, a), first)
  assert.equal(first[1], views[0])
  gpu.cloudWritten = 1
  const second = cloudResources(gpu, a)
  assert.notEqual(second, first)
  assert.equal(second[1], views[1])
  gpu.cloudWritten = 0
  assert.equal(cloudResources(gpu, a), first)
  // Entries replaced by the sky: the lists are written again, in place.
  const texture = {}
  assert.equal(
    cloudResources(gpu, { ...a, entries: [{ binding: 0, resource: texture as never }] }),
    first,
  )
  assert.deepEqual(first.slice(2), [0, texture])
})

test('the finish’s textures need a device that grants as many as it binds, and not one fewer', () => {
  const grants = (count: number) =>
    grantsPathTracedClouds({ limits: { maxSampledTexturesPerShaderStage: count } } as GPUDevice)
  assert.equal(grants(PT_CLOUD_FINISH_TEXTURES - 1), false)
  assert.equal(grants(PT_CLOUD_FINISH_TEXTURES), true)
  assert.equal(grants(PT_CLOUD_FINISH_TEXTURES + 4), true)
})

test('the finish’s texture count is the sampled textures its real layout binds with the clouds', () => {
  const sampled = (clouds: boolean) =>
    finishLayoutEntries(clouds)
      .flat()
      .filter((entry) => entry.texture).length
  assert.equal(sampled(true), PT_CLOUD_FINISH_TEXTURES)
  assert.ok(sampled(false) < sampled(true))
})

test('the map is made again in place only where its side moved', () => {
  const made: number[] = []
  const gpu = {
    cloudMaps: [] as { width: number }[],
    setCloudMap(side: number) {
      made.push(side)
      this.cloudMaps = [{ width: side }, { width: side }]
    },
  }
  const device = {} as GPUDevice
  const admit = (side: number) => admitCloudMap(device, gpu as never, side)
  assert.equal(admit(256), true)
  assert.equal(admit(256), true)
  assert.equal(admit(512), true)
  assert.deepEqual(made, [256, 512])
})

test('a light of the air casts the clouds’ shadows when its record says so', () => {
  const sun = {
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 1,
    castCloudShadows: true,
  } as SceneLight
  const moon = { ...sun, id: 'moon', castCloudShadows: false } as SceneLight
  assert.deepEqual(cloudShadowLightsOf({ atmosphereLight: (at) => (at === 0 ? sun : moon) }), [
    true,
    false,
  ])
  assert.deepEqual(cloudShadowLightsOf({ atmosphereLight: () => undefined }), [false, false])
})

test('a refusal of the map holds until the side moves or the room grows past what the map asks', () => {
  const refusal = { side: 512, room: 100, missing: 300 }
  assert.equal(cloudRefusalHolds(undefined, 512, 1000), false)
  assert.equal(cloudRefusalHolds(refusal, 256, 100), false)
  assert.equal(cloudRefusalHolds(refusal, 512, 100), true)
  assert.equal(cloudRefusalHolds(refusal, 512, 50), true)
  assert.equal(cloudRefusalHolds(refusal, 512, 250), true)
  assert.equal(cloudRefusalHolds(refusal, 512, 300), false)
})
