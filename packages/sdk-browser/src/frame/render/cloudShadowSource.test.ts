// The clouds' shadow maps' source and pass in the backend: the clouds drift by the world's time of the
// image, the source carries the sky light that asks for the sky occlusion, and the maps are built for
// it with no light casting a shadow map.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { skyAtQuality } from '../../../../sdk-core/src/modules/sky/descriptor.ts'
import { SKY_QUALITY_RULES } from '../../../../sdk-core/src/modules/sky/quality.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import { cloudShadowStandIn } from '../../lighting/atmosphere/cloudShadowStandIn.ts'
import { materialEntries } from '../../modules/sky/clouds/materialEntries.fixture.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { applySkyToRuntime, skyStateOf } from './encodeCloudsSky.ts'
import { captureCloudsOf } from './captureCloudsState.ts'
import { cloudShadowOf, encodeCloudShadow, setCloudShadowSource } from './encodeCloudShadow.ts'
import { runtime, SCENE, word } from './skyFollow.fixture.ts'
import { cloudShadowSourceOf } from './skyModuleSources.ts'

test('the clouds drift by the world’s time of the image, which a wall clock running on does not move', () => {
  const rt = runtime({})
  applySkyToRuntime(rt, word({ skyLight: true, clouds: true }), SCENE)
  const clock = skyStateOf(rt)!.clock
  const { graphClocks } = rt.run
  graphClocks.time = 12.5
  graphClocks.realTime = 700
  assert.equal(clock(), 12.5, 'the world’s time, not the wall clock')
  graphClocks.realTime = 900
  assert.equal(clock(), 12.5, 'the same value for every reader of the image')
  graphClocks.time = 13
  assert.equal(clock(), 13, 'and the next image’s')
})

test('the clouds’ shadow maps’ source carries the sky light that asks for the sky occlusion, where it affects the world', () => {
  const extras = { material: [] as GPUBindGroupEntry[], time: () => 0 }
  const followed = skyAtQuality(
    word({ skyLight: true, clouds: true }),
    resolveSettings(SKY_QUALITY_RULES, {}),
  )
  assert.equal(cloudShadowSourceOf(followed, extras)?.skyLight, followed.skyLight!.light)
  // A sky light that does not affect the world is no sky light of the scene: it asks for nothing.
  const apart = {
    ...followed,
    skyLight: {
      ...followed.skyLight!,
      light: { ...followed.skyLight!.light, affectsWorld: false },
    },
  }
  assert.equal(cloudShadowSourceOf(apart, extras)?.skyLight, undefined)
  assert.equal(
    cloudShadowSourceOf(word({ skyLight: false, clouds: true }), extras)?.skyLight,
    undefined,
  )
  assert.equal(
    cloudShadowSourceOf(word({ skyLight: true, clouds: false }), extras),
    undefined,
    'no clouds, no maps',
  )
})

test('the clouds’ maps are built for the sky occlusion with no light casting a shadow map, where the sky light asks for it', async () => {
  installGpuGlobals()
  const { device } = fakeDevice()
  const { buffer, material } = materialEntries(device)
  const views = { active: {}, main: {} }
  views.active = views.main
  const rt = {
    run: { frame: 1, graphClocks: { time: 0, realTime: 0 } },
    context: {},
    gpu: { targetSize: [64, 32], device },
    views,
    diag: { diagnosticFailure: (_: string, error: unknown) => assert.fail(String(error)) },
    lights: {
      store: createSceneLightStore(),
      buffer: buffer(GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
    },
  } as unknown as WebgpuPagesRuntime
  const clouds = skyAtQuality(
    word({ skyLight: true, clouds: true }),
    resolveSettings(SKY_QUALITY_RULES, {}),
  )
  const cam = { eye: [0, 100, 0], world: new Float64Array(16), perspective: 1 } as never
  const imageWith = async (asking: boolean) => {
    setCloudShadowSource(rt, {
      part: clouds.clouds!,
      material,
      time: () => 0,
      skyLight: { ...clouds.skyLight!.light, cloudAmbientOcclusion: asking },
    })
    // The programs compile off the frame: an image waits for them, a few ticks of the loop.
    for (let tick = 0; tick < 8; tick++) {
      rt.run.frame++
      encodeCloudShadow(rt, device, device.createCommandEncoder(), cam)
      await new Promise((done) => setImmediate(done))
    }
    return cloudShadowOf(rt)
  }
  assert.equal(
    await imageWith(false),
    undefined,
    'no light and no sky occlusion asked: no pass, no maps',
  )
  const set = await imageWith(true)
  assert.ok(set && set.ao !== set.maps[0], 'the sky occlusion map is built')
  // The sky light's capture reads the maps of this image, the stand-in where the image built none.
  Object.assign(rt.gpu, { deferred: { placeholders: { vsmBlueNoise: {} } } })
  const capture = captureCloudsOf(rt, clouds.clouds!, [])
  assert.equal(capture.cloudShadow, set)
  setCloudShadowSource(rt, undefined)
  assert.equal(capture.cloudShadow, cloudShadowStandIn(device))
})
