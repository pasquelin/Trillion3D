// The screen probes' flags and parameter words: what each image can read, and the words that moved.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { DEG2RAD } from '../../../../math/src/constants.ts'
import type { SceneRays } from '../surfaceCache/lighting/surfaceLighting.ts'
import { createScreenProbeParams } from './screen/params.ts'
import { screenProbeFlags } from './screen/modeFlags.ts'
import { IMAGE_READS } from './screen/imageReads.fixture.ts'
import {
  SCREEN_PROBE_FLAGS,
  SCREEN_PROBE_PARAMS,
  SCREEN_PROBE_PARAMS_BYTES,
  screenProbeGeometry,
} from './screen/screenProbeLayout.ts'

test('the screen probes flags say what each image can read: the screen, the history, the field, the vectors, the switches of its level', () => {
  const F = SCREEN_PROBE_FLAGS
  const ultra = screenProbeSettings()
  assert.equal(
    screenProbeFlags(ultra, IMAGE_READS),
    F.screenTraces |
      F.importance |
      F.importanceLighting |
      F.radianceHistory |
      F.temporal |
      F.cache |
      F.occlusion |
      F.sceneTraces |
      F.velocity |
      F.disocclusion |
      F.occlusionTemporal |
      F.fullResDepth |
      F.skipFoliageHits |
      F.backfaceDiffuse |
      F.materialAo,
  )
  const high = screenProbeSettings({ screenProbes: 'high' })
  assert.equal(
    screenProbeFlags(high, IMAGE_READS) & (F.stochastic | F.octahedral),
    F.stochastic | F.octahedral,
  )
  // The light the rays follow and the history it comes from are two settings of the importance sampling.
  const lit = (options: Parameters<typeof screenProbeSettings>[0]) =>
    screenProbeFlags(screenProbeSettings(options), IMAGE_READS) &
    (F.importance | F.importanceLighting | F.radianceHistory)
  assert.equal(
    lit({ screenProbeImportanceIncomingLighting: false }),
    F.importance | F.radianceHistory,
  )
  assert.equal(lit({ screenProbeProbeRadianceHistory: false }), F.importance | F.importanceLighting)
  assert.equal(lit({ screenProbeImportanceSampling: false }), 0)
})

test('the screen probes flags leave out what an image has not: no history, no vectors; and the temporal, detail and clamp switches follow the settings', () => {
  const F = SCREEN_PROBE_FLAGS
  const ultra = screenProbeSettings()
  const first = {
    ...IMAGE_READS,
    frame: 0,
    previousFrame: 0,
    history: false,
    screen: false,
    cache: false,
  }
  assert.equal(
    screenProbeFlags(ultra, first) &
      (F.screenTraces | F.radianceHistory | F.temporal | F.cache | F.velocity),
    0,
    'no history, so neither its vectors',
  )
  assert.equal(
    screenProbeFlags(screenProbeSettings({ screenProbeTemporal: false }), IMAGE_READS) & F.temporal,
    0,
  )
  // The scene trace is a switch, on by default.
  const scene = (options: Parameters<typeof screenProbeSettings>[0]) =>
    screenProbeFlags(screenProbeSettings(options), IMAGE_READS) & F.sceneTraces
  assert.equal(scene({}), F.sceneTraces, 'on by default')
  assert.equal(scene({ screenProbeSceneTraces: false }), 0)
  assert.equal(
    screenProbeFlags(screenProbeSettings({ screenProbeFastUpdateClamp: true }), IMAGE_READS) &
      F.fastUpdateClamp,
    F.fastUpdateClamp,
  )
  // The occlusion weighs the rough specular at the integration only where asked: off by default.
  const integration = (options: Parameters<typeof screenProbeSettings>[0]) =>
    screenProbeFlags(screenProbeSettings(options), IMAGE_READS) & F.occlusionInIntegration
  assert.equal(integration({}), 0, 'off by default')
  assert.equal(
    integration({ screenProbeShortRangeAOApplyDuringIntegration: true }),
    F.occlusionInIntegration,
  )
})

test('the hair and unlit hits of the screen trace are skipped only where asked, and the probes’ temporal filter runs only on an image that holds a history', () => {
  const F = SCREEN_PROBE_FLAGS
  const flag = (
    options: Parameters<typeof screenProbeSettings>[0],
    bit: number,
    image = IMAGE_READS,
  ) => screenProbeFlags(screenProbeSettings(options), image) & bit
  assert.equal(
    flag({}, F.skipHairHits | F.skipUnlitHits | F.probeTemporal),
    0,
    'all off by default',
  )
  assert.equal(flag({ screenProbeSkipHairHits: true }, F.skipHairHits), F.skipHairHits)
  assert.equal(flag({ screenProbeSkipUnlitHits: true }, F.skipUnlitHits), F.skipUnlitHits)
  assert.equal(flag({ screenProbeTemporalFilterProbes: true }, F.probeTemporal), F.probeTemporal)
  const first = { ...IMAGE_READS, history: false }
  assert.equal(flag({ screenProbeTemporalFilterProbes: true }, F.probeTemporal, first), 0)
  assert.equal(
    flag({ screenProbeTemporalFilterProbes: true, screenProbes: 'low' }, F.probeTemporal),
    0,
    'a level that casts no probe',
  )
})

test('the material’s occlusion reaches the integration by default, and the setting turns it off', () => {
  const F = SCREEN_PROBE_FLAGS
  const flag = (options: Parameters<typeof screenProbeSettings>[0]) =>
    screenProbeFlags(screenProbeSettings(options), IMAGE_READS) & F.materialAo
  assert.equal(flag({}), F.materialAo, 'on by default')
  assert.equal(flag({ screenProbeMaterialAO: false }), 0)
})

test('the screen probes parameters are the words of the settings and the image, and only the words that moved go up', () => {
  const held = new Uint32Array(SCREEN_PROBE_PARAMS.words)
  let sent = 0
  const device = {
    queue: {
      writeBuffer(_: unknown, __: number, image: Uint32Array, first: number, count: number) {
        held.set(image.subarray(first, first + count), first)
        sent += count
      },
    },
  } as unknown as GPUDevice
  const write = createScreenProbeParams(device, { size: SCREEN_PROBE_PARAMS_BYTES } as GPUBuffer)
  const settings = screenProbeSettings()
  const geometry = screenProbeGeometry(1920, 1080, settings)
  // The inverse of the last view-projection: its second column is (0, 2, 0, 0).
  const previousInverse = [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const image = (frame: number) => ({
    frame,
    previousFrame: frame - 1,
    history: true,
    screen: true,
    cache: true,
    velocity: true,
    previousInverse,
    relativeThickness: 0.03,
    historyThickness: 0.004,
    fullResDepth: true,
    skylightLeak: [0.1, 0.2, 0.3] as const,
    roughSpecularFoliage: 0.4,
    posesMoving: false,
  })
  write(geometry, settings, image(11))
  const at = SCREEN_PROBE_PARAMS.at
  const words = (from: number, count = 4) => Array.from(held.subarray(from, from + count))
  const floats = (from: number) => Array.from(new Float32Array(held.buffer, from * 4, 4))
  assert.deepEqual(words(at.size), [1920, 1080, 16, 11])
  assert.deepEqual(
    words(at.frames),
    [11, 11, 11, 0],
    'no index fixed: every family on the view’s frame',
  )
  assert.deepEqual(words(at.grid), [120, 68, 102, 4080])
  assert.deepEqual(words(at.mode), [3, 2, screenProbeFlags(settings, image(11)), 3])
  assert.deepEqual(words(at.counts), [10, 8160, 50, 8])
  assert.deepEqual(floats(at.weights), [-10000, -1000, 0.1, 10].map(Math.fround))
  assert.deepEqual(floats(at.spatial), [1000, 10 * DEG2RAD, 1, 200].map(Math.fround))
  assert.deepEqual(floats(at.occlusion), [2, 3, 0.3, 1].map(Math.fround))
  assert.deepEqual(floats(at.scene), [0.05, 0.01, Math.cos(45 * DEG2RAD), 0.03].map(Math.fround))
  assert.deepEqual(floats(at.motion), [0.005, 10, 0.9, 0.0001].map(Math.fround))
  assert.deepEqual(floats(at.tuning), [4, 0.4, 0.004, 0.03].map(Math.fround))
  assert.deepEqual(
    floats(at.trace),
    [2, 0, 0.8, 0.4].map(Math.fround),
    'rays marched through the field: the thickness scale the setting’s two; foliage hits skipped: no certainty steps; the rough specular up to a roughness of 0.8, of foliage the image’s (the reflections’ level’s row)',
  )
  assert.deepEqual(
    floats(at.foliage),
    [0.7, 1, -2500, 0.5].map(Math.fround),
    'the occlusion strength on foliage, the intensity, the interpolation weight on foliage: a quarter of the plane’s, the albedo the multiple bounces are capped at',
  )
  assert.deepEqual(
    floats(at.screen),
    [0.02, 0.5, 5, 0.5].map(Math.fround),
    'the hair bias of the screen trace, the history weight of the probes’ temporal filter, the extra occlusion’s furthest hit and exponent',
  )
  assert.deepEqual(
    floats(at.leak),
    [0.1, 0.2, 0.3, 0.3].map(Math.fround),
    'the sky light that leaks by channel, the roughness it is read at',
  )
  assert.equal(
    floats(at.cache)[3],
    Math.fround(1 / 10),
    'the inverse of the distance it leaks whole at, ten metres, after the cache’s three numbers',
  )
  assert.deepEqual(floats(at.previous + 4), [0, 2, 0, 0], 'the second column of the last inverse')
  const first = sent
  write(geometry, settings, image(11))
  assert.equal(sent, first, 'an image the same as the last sends nothing')
  write(geometry, settings, image(12))
  assert.deepEqual(
    [words(at.size)[3], words(at.mode).slice(0, 2), words(at.mode)[3]],
    [12, [4, 3], 4],
  )
  assert.ok(
    sent - first < SCREEN_PROBE_PARAMS.words,
    'the words from the rank to the turn, not the whole uniform',
  )
  write(geometry, screenProbeSettings({ screenProbeMaxRayDirections: 3 }), image(11))
  assert.equal(words(at.mode)[3], 11 % 3, 'the rays turn through the setting’s directions')
  const scale = screenProbeSettings({ screenProbeThicknessScaleWithoutField: 3 })
  write(geometry, scale, image(11))
  assert.equal(
    floats(at.trace)[0],
    3,
    'without the triangles, the pixels without a distance field are thicker by the setting’s scale',
  )
  write(geometry, scale, { ...image(11), rays: {} as SceneRays })
  assert.equal(floats(at.trace)[0], 1, 'with rays through the triangles, one for every pixel')
  // The fixed indices move the noise of three families apart (`frames`: the probes' gather state, their jitter, the stochastic lighting's) and the
  // tile jitter and ray turn with the jitter; the view's own frame (`size.w`) stays: the noise of the passes that follow no fixed index.
  const held12 = (options: Parameters<typeof screenProbeSettings>[0]) => {
    write(geometry, screenProbeSettings(options), image(12))
    return [
      words(at.size)[3],
      ...words(at.frames).slice(0, 3),
      ...words(at.mode).filter((_, k) => k !== 2),
    ]
  }
  assert.deepEqual(held12({}), [12, 12, 12, 12, 4, 3, 4], 'none fixed: the view’s own frame')
  assert.deepEqual(
    held12({ screenProbeFixedStateFrameIndex: 5 }),
    [12, 5, 5, 12, 5, 5, 5],
    'the probes’ state frame index holds their gather state and, alone, the jitter; the view’s frame and the stochastic lighting’s stay',
  )
  assert.deepEqual(
    held12({ screenProbeFixedJitterIndex: 6, screenProbeFixedStateFrameIndex: 5 }),
    [12, 5, 6, 12, 6, 6, 6],
    'the jitter index holds the jitter, the state frame index the gather state',
  )
  assert.deepEqual(
    held12({ stochasticLightingFixedStateFrameIndex: 7, screenProbeFixedStateFrameIndex: 5 }),
    [12, 7, 7, 7, 7, 7, 7],
    'the stochastic lighting’s index wins over the probes’ state frame index, and holds the jitter too',
  )
  assert.deepEqual(
    held12({ stochasticLightingFixedStateFrameIndex: 7, screenProbeFixedJitterIndex: 6 }),
    [12, 7, 6, 7, 6, 6, 6],
    'the jitter index wins over the stochastic lighting’s for the jitter alone',
  )
})
