// The sky's quality settings reach the sky light and the clouds the frame draws: the parts resolved
// with the defaults are followed under the live settings (`skyAtQuality`), whatever wrote them — the
// page, a preset, the editor.
import { readdirSync, readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../contracts/settingRules.ts'
import { mergeModuleParts, resolveModuleOption } from '../descriptor.ts'
import { cloudShadowWanted, resolveCloudShadowLight } from './cloudShadow.ts'
import { resolveCloudPart } from './clouds.ts'
import { resolveSky, skyAtQuality, SKY_MODULE } from './descriptor.ts'
import { DEFAULT_SKY_QUALITY, SKY_QUALITY_RULES, type SkyQualityOptions } from './quality.ts'
import { SKY_PRESET_LEVELS } from './qualityPresets.ts'
import { cloudSkyOcclusionSide, cloudSkyOcclusionWanted } from './cloudSkyOcclusion.ts'
import { lowerHemisphereOf, resolveSkyLight, SKY_LIGHT_RULES, skyLightColor } from './skyLight.ts'
import { resolveSunPart } from './sunPart.ts'
import { temperatureColour } from './sunColour.ts'
import { temperatureFactor } from './blackBody.ts'

const sky = resolveSky(
  mergeModuleParts(SKY_MODULE, [resolveModuleOption(SKY_MODULE, true) as never]),
  DEFAULT_SKY_QUALITY,
)
const quality = (options: SkyQualityOptions) => resolveSettings(SKY_QUALITY_RULES, options)

test('the sky light and the clouds are followed under the live quality settings, the other parts as they are', () => {
  const live = quality({ cloudViewSamplesMax: 40, skyLightFacesPerFrame: 3 })
  const followed = skyAtQuality(sky, live)
  assert.equal(followed.clouds!.quality, live)
  assert.equal(followed.skyLight!.quality, live)
  assert.equal(followed.clouds!.settings, sky.clouds!.settings, 'the layer is the same')
  assert.equal(followed.clouds!.material, sky.clouds!.material, 'and the material')
  assert.equal(followed.skyLight!.light, sky.skyLight!.light)
  assert.equal(followed.atmosphere, sky.atmosphere)
  assert.equal(followed.sun, sky.sun)
  // What the marcher is told of the quality is worked out again: 96 samples at a scale of 1, at most the setting.
  assert.deepEqual(
    [sky.clouds!.gpu.viewSamplesMost, followed.clouds!.gpu.viewSamplesMost],
    [96, 40],
  )
})

test('`cloudShadowMap: false` stops the clouds’ shadow maps, and `cloudsOn: false` the clouds', () => {
  const light = resolveCloudShadowLight({ castCloudShadows: true })
  assert.equal(cloudShadowWanted(sky.clouds!.quality, light), true, 'built with the defaults')
  const off = skyAtQuality(sky, quality({ cloudShadowMap: false }))
  assert.equal(cloudShadowWanted(off.clouds!.quality, light), false)
  const none = skyAtQuality(sky, quality({ cloudsOn: false }))
  assert.equal(none.clouds, undefined, 'the clouds are out where the settings switch them off')
  assert.ok(none.skyLight && none.atmosphere, 'the rest of the sky stays')
})

test('each preset’s sky light intensity factor reaches the light’s colour', () => {
  // The reference's quality levels write the sky light's intensity factor, 0.8 at the lowest level and
  // 1 above it (its global illumination group's rows), and no cloud setting: the sky light is the
  // part they change.
  const base = skyLightColor(sky.skyLight!, true)[0]
  const at = (preset: Record<string, number> | undefined) =>
    skyLightColor(skyAtQuality(sky, quality(preset ?? {})).skyLight!, true)[0] / base
  assert.equal(at(SKY_PRESET_LEVELS.indirectLight.smooth), 0.8)
  assert.equal(at(SKY_PRESET_LEVELS.indirectLight.balanced), 1)
  assert.equal(at(SKY_PRESET_LEVELS.indirectLight.fine), 1)
  assert.equal(at(undefined), 1, 'the top level writes nothing')
})

test('the clouds’ reflection sample scales are 1, which gives 80 view samples and 10 shadow samples', () => {
  const { settings, gpu } = resolveCloudPart({}, DEFAULT_SKY_QUALITY)
  assert.deepEqual([settings.reflectionSamplesScale, settings.reflectionShadowSamplesScale], [1, 1])
  // 96 and 10 at a scale of 1, held to the quality's most (80 and 24).
  assert.deepEqual([gpu.reflectionSamplesMost, gpu.reflectionShadowSamplesMost], [80, 10])
})

test('the cloud material marches its shadow unless it is told to read the maps', () => {
  assert.equal(resolveCloudPart({}, DEFAULT_SKY_QUALITY).material.rayMarchVolumeShadow, true)
  assert.equal(
    resolveCloudPart({ rayMarchVolumeShadow: false }, DEFAULT_SKY_QUALITY).material
      .rayMarchVolumeShadow,
    false,
  )
  assert.throws(
    () => resolveCloudPart({ rayMarchVolumeShadow: 'no' }, DEFAULT_SKY_QUALITY),
    /rayMarchVolumeShadow/,
  )
})

test('the sky light’s cloud occlusion fields are the component’s: its defaults and its ranges', () => {
  const light = resolveSkyLight({}, DEFAULT_SKY_QUALITY).light
  assert.deepEqual(
    [
      light.cloudAmbientOcclusion,
      light.cloudAmbientOcclusionStrength,
      light.cloudAmbientOcclusionExtentKm,
      light.cloudAmbientOcclusionMapResolutionScale,
      light.cloudAmbientOcclusionApertureScale,
    ],
    [false, 1, 150, 1, 0.05],
  )
  // The strength from 0, the extent from 1 km, the resolution scale from 0.25, the aperture 0 to 1.
  assert.throws(
    () => resolveSkyLight({ cloudAmbientOcclusionStrength: -1 }, DEFAULT_SKY_QUALITY),
    /at least 0/,
  )
  assert.throws(
    () => resolveSkyLight({ cloudAmbientOcclusionExtentKm: 0.5 }, DEFAULT_SKY_QUALITY),
    /from 1/,
  )
  assert.throws(
    () => resolveSkyLight({ cloudAmbientOcclusionMapResolutionScale: 0.1 }, DEFAULT_SKY_QUALITY),
    /from 0\.25/,
  )
  assert.throws(
    () => resolveSkyLight({ cloudAmbientOcclusionApertureScale: 2 }, DEFAULT_SKY_QUALITY),
    /from 0 to 1/,
  )
})

test('the sky occlusion map is built for a sky light that asks, under the quality switch, at 512 texels times its scale', () => {
  const asks = resolveSkyLight({ cloudAmbientOcclusion: true }, DEFAULT_SKY_QUALITY).light
  const live = sky.clouds!.quality
  assert.equal(cloudSkyOcclusionWanted(live, asks), true)
  assert.equal(
    cloudSkyOcclusionWanted(live, resolveSkyLight({}, DEFAULT_SKY_QUALITY).light),
    false,
    'the flag is off by default',
  )
  assert.equal(cloudSkyOcclusionWanted(live, undefined), false, 'no sky light')
  assert.equal(cloudSkyOcclusionWanted(quality({ cloudSkyAO: false }), asks), false)
  const scaled = (scale: number) =>
    cloudSkyOcclusionSide(
      { ...asks, cloudAmbientOcclusionMapResolutionScale: scale },
      live.cloudSkyAOResolutionMax,
    )
  assert.deepEqual(
    [scaled(1), scaled(0.25), scaled(8)],
    [512, 128, 2048],
    'held to the largest side',
  )
})

test('no setting is declared that nothing reads: the removed ones are no field of the sky any more', () => {
  assert.ok(!('lightShaftAfterDof' in SKY_QUALITY_RULES), 'lightShaftAfterDof')
  // The capture draws the scene's sky meshes with a depth buffer, which this switch asks for: it is a field again.
  assert.equal(SKY_QUALITY_RULES.skyLightDepthBuffer.default, true)
  for (const field of [
    'indirectLightingIntensity',
    'samplesPerPixel',
    'affectReflection',
    'affectGlobalIllumination',
  ])
    assert.ok(!(field in SKY_LIGHT_RULES), field)
  assert.throws(
    () => resolveSkyLight({ samplesPerPixel: 4 }, DEFAULT_SKY_QUALITY),
    /samplesPerPixel/,
  )
})

test('a setting the reference clamps takes any number and is read at the clamp, not refused', () => {
  const wide = quality({
    cloudShadowMapNewFrameWeight: 2,
    cloudShadowMapSpatialFiltering: 9,
    cloudLocalLightShadowSamples: 500,
    cloudRenderTargetScale: 3,
    cloudEmptySpaceSkippingDepthKm: 0.5,
  })
  assert.deepEqual(
    [
      wide.cloudShadowMapNewFrameWeight,
      wide.cloudShadowMapSpatialFiltering,
      wide.cloudLocalLightShadowSamples,
      wide.cloudRenderTargetScale,
      wide.cloudEmptySpaceSkippingDepthKm,
    ],
    [2, 9, 500, 3, 0.5],
  )
})

test('the sky light’s lower hemisphere has the colour’s alpha as a coverage, 1 by default, from 0 to 1', () => {
  assert.equal(resolveSkyLight({}, DEFAULT_SKY_QUALITY).light.lowerHemisphereCoverage, 1)
  assert.equal(
    resolveSkyLight({ lowerHemisphereCoverage: 0.25 }, DEFAULT_SKY_QUALITY).light
      .lowerHemisphereCoverage,
    0.25,
  )
  assert.throws(
    () => resolveSkyLight({ lowerHemisphereCoverage: 2 }, DEFAULT_SKY_QUALITY),
    /from 0 to 1/,
  )
  const lower = resolveSkyLight(
    {
      lowerHemisphereColor: [0.1, 0.2, 0.3],
      lowerHemisphereCoverage: 0.5,
    },
    DEFAULT_SKY_QUALITY,
  )
  assert.deepEqual(lowerHemisphereOf(lower.light), [0.1, 0.2, 0.3, 0.5], 'the copy mixes by it')
})

test('the sky light part’s lower hemisphere is the sky’s own by default, a solid colour when asked', () => {
  assert.equal(resolveSkyLight({}, DEFAULT_SKY_QUALITY).light.lowerHemisphereIsSolidColor, false)
  const solid = resolveSkyLight({ lowerHemisphereIsSolidColor: true }, DEFAULT_SKY_QUALITY)
  assert.equal(solid.light.lowerHemisphereIsSolidColor, true)
})

test('the sun part’s temperature is the part’s own rule, on at 6500 K; the colour of a kelvin is one function', () => {
  const { light } = resolveSunPart({})
  assert.deepEqual([light.useTemperature, light.temperatureKelvin], [true, 6500])
  assert.deepEqual(
    temperatureColour([1, 1, 1], { useTemperature: true, temperatureKelvin: 6500 }),
    temperatureFactor(6500),
  )
})

test('the clouds on the translucent surfaces: the fog laid late on their image is off, the soft blending is half a kilometre', () => {
  const live = quality({})
  assert.equal(live.cloudFogLateOnTranslucent, false)
  assert.equal(live.cloudSoftBlendingDistanceOnTranslucent, 0.5)
  const asked = quality({
    cloudFogLateOnTranslucent: true,
    cloudSoftBlendingDistanceOnTranslucent: 2,
  })
  assert.deepEqual(
    [asked.cloudFogLateOnTranslucent, asked.cloudSoftBlendingDistanceOnTranslucent],
    [true, 2],
  )
})

test('the sky module’s sources name no reference asset path, actor id or property: its own fields are named by ours', () => {
  const here = new URL('./', import.meta.url)
  const sources = readdirSync(here).filter(
    (name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name),
  )
  assert.ok(sources.length > 10)
  for (const name of sources)
    assert.doesNotMatch(
      readFileSync(new URL(name, here), 'utf8'),
      /Content\/Maps|HR\/LT|\bb(?:Enable|Cast|Lower)[A-Z]\w*|\.u(?:sf|sh)\b|FrameExposureScale/,
      name,
    )
})
