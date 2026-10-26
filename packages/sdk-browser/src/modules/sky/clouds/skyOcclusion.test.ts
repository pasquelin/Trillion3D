// The clouds' sky occlusion map in a frame: its plan (side, frame, filter), its blocks, and the run
// that builds it where the sky light asks and hands the lookups its map and matrix.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../../sdk-core/src/contracts/settingRules.ts'
import {
  mergeModuleParts,
  resolveModuleOption,
} from '../../../../../sdk-core/src/modules/descriptor.ts'
import {
  resolveSky,
  skyAtQuality,
  SKY_MODULE,
} from '../../../../../sdk-core/src/modules/sky/descriptor.ts'
import {
  DEFAULT_SKY_QUALITY,
  SKY_QUALITY_RULES,
  type SkyQualityOptions,
} from '../../../../../sdk-core/src/modules/sky/quality.ts'
import { resolveSkyLight } from '../../../../../sdk-core/src/modules/sky/skyLight.ts'
import { CLOUD_SHADOW_BLOCK } from '../../../lighting/atmosphere/cloudShadowRead.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { materialEntries } from './materialEntries.fixture.ts'
import { createCloudShadowRun, type CloudShadowRunInput } from './shadowRun.ts'
import { CLOUD_SHADOW_LAYOUT } from './shadowLayout.ts'
import { skyOcclusionPlan } from './skyOcclusionFrame.ts'
import { writeSkyOcclusionFilter, writeSkyOcclusionTrace } from './skyOcclusionLayout.ts'
import { SKY_OCCLUSION_FILTER_LAYOUT } from './skyOcclusionWgsl.ts'

const sky = resolveSky(
  mergeModuleParts(SKY_MODULE, [resolveModuleOption(SKY_MODULE, true) as never]),
  DEFAULT_SKY_QUALITY,
)
const part = (options: SkyQualityOptions = {}) =>
  skyAtQuality(sky, resolveSettings(SKY_QUALITY_RULES, options)).clouds!
/** A sky light that asks for the occlusion, with the component's other defaults unless named. */
const light = (fields: Record<string, unknown> = {}) =>
  resolveSkyLight({ cloudAmbientOcclusion: true, ...fields }, DEFAULT_SKY_QUALITY).light
/** A camera on the ground of the planet, the planet's vertical the scene's y. */
const CAMERA = { eye: [0, 0, 0], eyeFromPlanetKm: [0, 6360, 0], planetRadiusKm: 6360 }

test('the map is the light’s scale on 512 texels a side, held to the quality’s largest side', () => {
  const side = (scale: number, most = 2048) =>
    skyOcclusionPlan(
      { part: part({ cloudSkyAOResolutionMax: most }), ...CAMERA },
      light({
        cloudAmbientOcclusionMapResolutionScale: scale,
      }),
    ).side
  assert.equal(side(1), 512, 'the component’s scale of 1')
  assert.equal(side(0.25), 128)
  assert.equal(side(8), 2048, 'a scale of 8 is 4096, held to the largest side')
  assert.equal(side(8, 1024), 1024)
})

test('the plan’s frame looks along the planet’s vertical down at the point under the camera, 10 samples a ray', () => {
  const layer = part().settings
  const plan = skyOcclusionPlan({ part: part(), ...CAMERA }, light())
  assert.equal(plan.filtered, true, 'the filter runs by default')
  assert.equal(plan.frame.samples, 10)
  assert.deepEqual(
    plan.frame.rayDirection.map((v) => Math.round(v * 1e9) / 1e9),
    [0, -1, 0],
  )
  // The depth range is the layer's top and one snap length (20 km); the far plane twice it.
  const rangeKm = layer.baseAltitudeKm + layer.thicknessKm + 20
  assert.ok(Math.abs(plan.frame.farDepthKm - 2 * rangeKm) < 1e-6)
  // The point under the camera sits at the map's centre, half way along its depth.
  const m = plan.frame.clipFromCamera
  const [x, y, z, w] = [m[12], m[13], m[14], m[15]]
  assert.deepEqual(
    [x / w, y / w, z / w].map((v) => Math.round(v * 1e9) / 1e9),
    [0, 0, 0.5],
  )
  // Where the quality switches the filter off, the plan says so.
  assert.equal(
    skyOcclusionPlan({ part: part({ cloudSkyAOFiltering: false }), ...CAMERA }, light()).filtered,
    false,
  )
})

test('the trace block holds the light’s strength, no bias and the frame’s samples; the filter block the aperture', () => {
  const asked = light({
    cloudAmbientOcclusionStrength: 0.6,
    cloudAmbientOcclusionApertureScale: 0.2,
  })
  const clouds = part()
  const plan = skyOcclusionPlan({ part: clouds, ...CAMERA }, asked)
  const trace = new Float32Array(CLOUD_SHADOW_LAYOUT.words)
  const image = {
    frame: plan.frame,
    side: plan.side,
    temporal: { tracedSide: plan.side, pixel: [1, 1, 0, 0] as const },
    time: 3,
    planetRadiusKm: 6360,
  }
  writeSkyOcclusionTrace(trace, image, asked, clouds)
  const at = CLOUD_SHADOW_LAYOUT.at
  assert.deepEqual(Array.from(trace.subarray(at.texel, at.texel + 4)), [512, 512, 1 / 512, 1 / 512])
  assert.deepEqual(Array.from(trace.subarray(at.pixel, at.pixel + 4)), [1, 1, 0, 0], 'no halving')
  assert.deepEqual(
    Array.from(trace.subarray(at.output, at.output + 3)),
    [Math.fround(0.6), 0, 10],
    'the strength of the light, no depth bias, the samples',
  )
  const filter = new Float32Array(SKY_OCCLUSION_FILTER_LAYOUT.words)
  writeSkyOcclusionFilter(filter, 512, asked, clouds)
  const f = SKY_OCCLUSION_FILTER_LAYOUT.at
  const texel = (150 * 1e5) / 512
  assert.deepEqual(Array.from(filter.subarray(f.size, f.size + 4)), [512, 512, 1 / 512, 1 / 512])
  assert.ok(
    Math.abs(filter[f.texelWorld] - texel) < 1e-3,
    'a texel is the extent over the side, in centimetres',
  )
  assert.deepEqual(
    Array.from(filter.subarray(f.aperture, f.aperture + 4)).map((v) => Math.round(v * 1e6) / 1e6),
    [0.2, 0.8, clouds.settings.baseAltitudeKm * 1e5, 0],
  )
})

/** The run over the kit's device: the resources its trace binds, and the image's inputs. */
async function runOver(options: SkyQualityOptions) {
  const kit = fakeDevice()
  const { device } = kit
  const run = createCloudShadowRun(device, (error) => assert.fail(String(error)))
  const { buffer, material } = materialEntries(device)
  const input = (skyLight?: ReturnType<typeof light>): CloudShadowRunInput => ({
    part: part(options),
    lights: [undefined, undefined],
    ...CAMERA,
    time: 0,
    frameIndex: 0,
    material,
    air: {
      buffer: buffer(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
      frame: buffer(GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    },
    keepsState: false,
    skyLight,
  })
  // The pipelines compile off the frame: the maps wait for them.
  for (let tick = 0; tick < 5 && !run.ready; tick++) await new Promise((done) => setImmediate(done))
  assert.ok(run.ready)
  return { kit, run, input }
}

/** The block's words as the run last wrote them, from the buffer the kit kept. */
const blockOf = (set: { block: GPUBuffer }) =>
  new Float32Array((set.block as unknown as { data: Uint8Array }).data.buffer.slice(0))

test('the run builds the sky occlusion where the sky light asks: the trace, then the filter, and hands the lookups its map and matrix', async () => {
  const { kit, run, input } = await runOver({})
  const encoder = kit.device.createCommandEncoder()
  // The filter's pipeline is asked when the map is first wanted: the image waits for it, with none.
  const first = run.encode(encoder, input(light()))
  assert.equal(first.ao, first.maps[0], 'no map yet: the stand-in')
  assert.equal(blockOf(first)[CLOUD_SHADOW_BLOCK.at.far + 2], 0, 'and the block says none')
  for (let tick = 0; tick < 5; tick++) await new Promise((done) => setImmediate(done))
  const before = kit.dispatches.length
  const set = run.encode(encoder, input(light()))
  assert.notEqual(set.ao, set.maps[0], 'the map')
  assert.deepEqual(
    kit.dispatches.slice(before).map((d) => d.entryPoint),
    ['cloudShadowMain', 'skyOcclusionFilterMain'],
    'the shadow trace, then the hemisphere filter',
  )
  const words = blockOf(set)
  const plan = skyOcclusionPlan({ part: part(), ...CAMERA }, light())
  const { at } = CLOUD_SHADOW_BLOCK
  assert.equal(words[at.far + 2], Math.fround(plan.frame.farDepthKm))
  assert.deepEqual(
    Array.from(words.subarray(at.clipSky, at.clipSky + 16)),
    Array.from(plan.frame.clipFromCamera, Math.fround),
  )
  assert.deepEqual(
    [kit.textures.filter((t) => /sky occlusion/.test(t.label ?? '')).length],
    [2],
    'a traced texture and a filtered one',
  )
  // The sky light stops asking: no pass, no map, the block says none, the textures are given back.
  const after = kit.dispatches.length
  const none = run.encode(encoder, input(undefined))
  assert.equal(kit.dispatches.length, after)
  assert.equal(none.ao, none.maps[0])
  assert.equal(blockOf(none)[at.far + 2], 0)
  assert.equal(kit.textures.filter((t) => /sky occlusion/.test(t.label ?? '')).length, 2)
  assert.ok(kit.destroyed.length >= 2, 'the map’s textures are destroyed')
})

test('without the filter the trace’s map is the one read, and a light that does not ask builds nothing', async () => {
  const { kit, run, input } = await runOver({ cloudSkyAOFiltering: false })
  const encoder = kit.device.createCommandEncoder()
  run.encode(encoder, input(light()))
  for (let tick = 0; tick < 5; tick++) await new Promise((done) => setImmediate(done))
  const before = kit.dispatches.length
  const set = run.encode(encoder, input(light()))
  assert.deepEqual(
    kit.dispatches.slice(before).map((d) => d.entryPoint),
    ['cloudShadowMain'],
  )
  assert.notEqual(set.ao, set.maps[0])
  const quiet = kit.dispatches.length
  run.encode(encoder, input(light({ cloudAmbientOcclusion: false })))
  assert.equal(kit.dispatches.length, quiet, 'a sky light with the flag off builds none')
  const off = await runOver({ cloudSkyAO: false })
  const offEncoder = off.kit.device.createCommandEncoder()
  off.run.encode(offEncoder, off.input(light()))
  assert.equal(off.kit.dispatches.length, 0, 'the quality switch off builds none')
})
