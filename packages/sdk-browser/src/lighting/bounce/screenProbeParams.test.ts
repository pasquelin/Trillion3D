// The screen probes' flags and parameter words: what each image can read, and the words that moved.

import test from 'node:test'
import assert from 'node:assert/strict'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { createScreenProbeParams } from './screen/params.ts'
import { screenProbeFlags } from './screen/modeFlags.ts'
import {
  SCREEN_PROBE_FLAGS,
  SCREEN_PROBE_PARAMS,
  SCREEN_PROBE_PARAMS_BYTES,
  screenProbeGeometry,
} from './screen/screenProbeLayout.ts'

/** What an image with all of it can read: its screen, history, field and vectors. */
const all = {
  frame: 1,
  previousFrame: 0,
  history: true,
  screen: true,
  cache: true,
  velocity: true,
  previousInverse: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  relativeThickness: 0.02,
  fullResDepth: true,
}

test('the screen probes flags say what each image can read: the screen, the history, the field, the vectors, the switches of its level', () => {
  const F = SCREEN_PROBE_FLAGS
  const ultra = screenProbeSettings()
  assert.equal(
    screenProbeFlags(ultra, all),
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
      F.backfaceDiffuse,
  )
  const high = screenProbeSettings({ screenProbes: 'high' })
  assert.equal(
    screenProbeFlags(high, all) & (F.stochastic | F.octahedral),
    F.stochastic | F.octahedral,
  )
  // The light the rays follow and the history it comes from are two settings of the importance sampling.
  const lit = (options: Parameters<typeof screenProbeSettings>[0]) =>
    screenProbeFlags(screenProbeSettings(options), all) &
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
  const first = { ...all, frame: 0, previousFrame: 0, history: false, screen: false, cache: false }
  assert.equal(
    screenProbeFlags(ultra, first) &
      (F.screenTraces | F.radianceHistory | F.temporal | F.cache | F.velocity),
    0,
    'no history, so neither its vectors',
  )
  assert.equal(
    screenProbeFlags(screenProbeSettings({ screenProbeTemporal: false }), all) & F.temporal,
    0,
  )
  // The scene trace is a switch, on by default.
  const scene = (options: Parameters<typeof screenProbeSettings>[0]) =>
    screenProbeFlags(screenProbeSettings(options), all) & F.sceneTraces
  assert.equal(scene({}), F.sceneTraces, 'on by default')
  assert.equal(scene({ screenProbeSceneTraces: false }), 0)
  assert.equal(
    screenProbeFlags(screenProbeSettings({ screenProbeFastUpdateClamp: true }), all) &
      F.fastUpdateClamp,
    F.fastUpdateClamp,
  )
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
    fullResDepth: true,
  })
  write(geometry, settings, image(11))
  const at = SCREEN_PROBE_PARAMS.at
  const words = (from: number, count = 4) => Array.from(held.subarray(from, from + count))
  const floats = (from: number) => Array.from(new Float32Array(held.buffer, from * 4, 4))
  assert.deepEqual(words(at.size), [1920, 1080, 16, 11])
  assert.deepEqual(words(at.grid), [120, 68, 102, 4080])
  assert.deepEqual(words(at.mode), [3, 2, screenProbeFlags(settings, image(11)), 3])
  assert.deepEqual(words(at.counts), [10, 8160, 50, 8])
  assert.deepEqual(floats(at.weights), [-10000, -1000, 0.1, 10].map(Math.fround))
  assert.deepEqual(floats(at.spatial), [1000, 10 * DEG2RAD, 1, 200].map(Math.fround))
  assert.deepEqual(floats(at.occlusion), [2, 3, 0.3, 1].map(Math.fround))
  assert.deepEqual(floats(at.scene), [0.05, 0.01, Math.cos(45 * DEG2RAD), 0].map(Math.fround))
  assert.deepEqual(floats(at.motion), [0.005, 10, 0.9, 0.0001].map(Math.fround))
  assert.deepEqual(floats(at.tuning), [4, 0.4, 0.005, 0.03].map(Math.fround))
  assert.deepEqual(
    floats(at.trace),
    [2, 0, 0.8, 0.8].map(Math.fround),
    'foliage hits skipped: no certainty steps; the rough specular up to a roughness of 0.8, of foliage too',
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
})
