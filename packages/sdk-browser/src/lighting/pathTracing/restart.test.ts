// When the accumulation starts over, and how the blocks of an image's dispatches are written.
import { pathTracingBytes } from './gpuState.ts'
import { NO_SCENE_MASKS, type SceneMaskPrograms } from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { skyTableMips, skyTableSize } from './skyWgsl.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { PATH_TRACING_RULES } from '../../../../sdk-core/src/contracts/pathTracingOptions.ts'
import {
  compactionDepthOf,
  createBlocks,
  writeBlock,
  type PathTracingBlockImage,
} from './blocks.ts'
import { PT_STATE_BYTES } from './pathWgsl.ts'
import { advanced, restartReason, restarted, runOf, type PathTracingInputs } from './restart.ts'
import { PT_PASS_ROUNDS, PT_VIEW, PT_VIEW_STRIDE } from './viewWgsl.ts'
import { tileSideOf, tilesOf } from './gpuState.ts'
import { queueListBase, queueWords } from './queueWgsl.ts'

const inputs = (options = {}, over: Partial<PathTracingInputs> = {}): PathTracingInputs => ({
  settings: resolveSettings(PATH_TRACING_RULES, { pathTracing: true, ...options }),
  size: [640, 480],
  scene: 1,
  lights: 1,
  camera: [1, 0, 0, 0, 0, 1],
  sky: 'none',
  cutBy: NO_SCENE_MASKS,
  cutoutRevision: 0,
  exposure: 1,
  ...over,
})

test('an image continues the run it is the same view of, and starts over for what changes the image', () => {
  const base = inputs()
  const run = runOf(base)
  assert.equal(restartReason(undefined, base), 'first image')
  assert.equal(restartReason(run, inputs()), undefined)
  assert.equal(restartReason(run, inputs({ pathTracingMaxBounces: 4 })), 'settings')
  assert.equal(restartReason(run, inputs({}, { size: [641, 480] })), 'size')
  assert.equal(restartReason(run, inputs({}, { scene: 2 })), 'scene')
  assert.equal(restartReason(run, inputs({}, { lights: 2 })), 'lights')
  assert.equal(restartReason(run, inputs({}, { sky: '1,1,1,1' })), 'sky')
  assert.equal(restartReason(run, inputs({}, { cutoutRevision: 1 })), 'cutout')
  assert.equal(
    restartReason(run, inputs({}, { cutBy: [{ key: 'a' }] as unknown as SceneMaskPrograms })),
    'cutout',
  )
  assert.equal(restartReason(run, inputs({}, { camera: [1, 0, 0, 0, 0, 1.0001] })), 'camera')
})

test('the denoiser, the bar and the wiper do not restart; the exposure does only past a factor of 16', () => {
  const run = runOf(inputs())
  assert.equal(
    restartReason(
      run,
      inputs({
        pathTracingDenoiser: false,
        pathTracingProgressDisplay: false,
        pathTracingWiperMode: true,
      }),
    ),
    undefined,
  )
  assert.equal(restartReason(run, inputs({}, { exposure: 15 })), undefined)
  assert.equal(restartReason(run, inputs({}, { exposure: 17 })), 'exposure')
  assert.equal(restartReason(run, inputs({}, { exposure: 1 / 17 })), 'exposure')
})

test('a restart resets the sample and keeps the frame index; a traced image counts one in both', () => {
  const counters = { iteration: 7, frameIndex: 40, lastDenoiserMode: 1 }
  assert.deepEqual(restarted(counters), {
    iteration: 0,
    frameIndex: 40,
    lastDenoiserMode: 1,
  })
  assert.deepEqual(advanced(counters, true, 0), {
    iteration: 8,
    frameIndex: 41,
    lastDenoiserMode: 0,
  })
  assert.equal(advanced(counters, false, 1).iteration, 7)
})

test('a block holds the image’s numbers at the offsets of the layout, a stride apart, the bounce and the blend factor its own', () => {
  const blocks = createBlocks(3)
  const image: PathTracingBlockImage = {
    inverseViewProjection: Array.from({ length: 16 }, (_, i) => i),
    viewProjection: Array.from({ length: 16 }, (_, i) => 100 + i),
    eye: [1, 2, 3],
    baseExposure: 0.5,
    size: [640, 480],
    maxSamples: 64,
    iteration: 3,
    temporalSeed: 99,
    maxBounces: 8,
    misMode: 2,
    samplerType: 0,
    maxPathIntensity: 24,
    approximateCaustics: true,
    backgroundAlpha: 0,
    emissive: true,
    viewFlags: 0,
    visibleLights: 0,
    adaptive: false,
    lights: 5,
    pathCapacity: 4096,
    bounceLevels: 6,
    compactionDepth: 3,
    errorThreshold: 0.001,
    filterWidth: 3,
    passRounds: PT_PASS_ROUNDS,
  }
  assert.equal(writeBlock(blocks, 2, image, [64, 0, 64, 32], 4, 2), 2 * PT_VIEW_STRIDE)
  const at = PT_VIEW.at
  const base = (2 * PT_VIEW_STRIDE) / 4
  assert.equal(blocks.floats[base + at.inverseViewProjection + 5], 5)
  assert.equal(blocks.floats[base + at.viewProjection + 5], 105)
  assert.equal(blocks.floats[base + at.sampling + 1], 3)
  assert.deepEqual([...blocks.floats.subarray(base + at.eye, base + at.eye + 4)], [1, 2, 3, 0.5])
  assert.deepEqual([...blocks.words.subarray(base + at.tile, base + at.tile + 4)], [64, 0, 64, 32])
  assert.equal(blocks.words[base + at.flags + 3], 4)
  assert.deepEqual(
    [...blocks.floats.subarray(base + at.sampling + 2, base + at.sampling + 4)],
    [2, PT_PASS_ROUNDS],
  )
  assert.equal(blocks.floats[base + at.limits + 3], 0.25)
  assert.equal(blocks.words[base + at.counts + 3], queueListBase(6))
  assert.equal(blocks.words[base + at.counts + 2], 3)
  assert.equal(blocks.floats[(1 * PT_VIEW_STRIDE) / 4 + at.eye], 0)
  assert.ok(PT_VIEW.words * 4 <= PT_VIEW_STRIDE)
})

test('the traced atmosphere’s settings restart the accumulation', () => {
  const run = runOf(inputs())
  assert.equal(restartReason(run, inputs({ pathTracingEnableReferenceAtmosphere: 1 })), 'settings')
  assert.equal(restartReason(run, inputs({ pathTracingMaxRaymarchSteps: 100 })), 'settings')
  assert.equal(restartReason(run, inputs({ pathTracingVolumeMISMode: 0 })), 'settings')
})

test('the traced clouds’ settings restart the accumulation', () => {
  const run = runOf(inputs())
  for (const change of [
    { pathTracingEnableReferenceClouds: false },
    { pathTracingCloudAccelerationMapResolution: 256 },
    { pathTracingCloudAccelerationMapNumSamples: 8 },
    { pathTracingCloudAccelerationMapVisualize: true },
    { pathTracingCloudMultipleScatterMode: 2 },
    { pathTracingCloudRoughnessCutoff: 0.5 },
  ])
    assert.equal(restartReason(run, inputs(change)), 'settings')
})

test('the view is cut in tiles that fit one storage binding, and the queue holds a count a bounce, two for the retried paths and four lists', () => {
  assert.deepEqual(tilesOf([100, 50], 64), [
    [0, 0, 64, 50],
    [64, 0, 36, 50],
  ])
  const device = {
    limits: { maxStorageBufferBindingSize: PT_STATE_BYTES * 64 * 64, maxBufferSize: 1 << 30 },
  } as GPUDevice
  assert.equal(tileSideOf(device, 2048), 64)
  assert.equal(tileSideOf(device, 32), 64)
  assert.equal(queueWords(8, 100), 8 + 2 + 400)
})

test('the sky table is twice the cube’s side rounded up to a power of two, held to the device; its bytes and the tracer’s grow with the view', () => {
  assert.equal(skyTableSize(256, 16384), 512)
  assert.equal(skyTableSize(100, 16384), 256)
  assert.equal(skyTableSize(2048, 2048), 2048)
  assert.equal(skyTableMips(512), 10)
  const small = pathTracingBytes([640, 480], 64, 8, 80, 256, 8, 8, 256)
  assert.ok(pathTracingBytes([1280, 960], 64, 8, 80, 256, 8, 8, 256) > 3 * small * 0.5)
  assert.ok(pathTracingBytes([640, 480], 64, 8, 80, 256, 8, 8, 1024) > small)
  assert.ok(small > 640 * 480 * 36 * 2)
})

test('the compaction depth is the setting, or the last bounce for a value under one or past it', () => {
  assert.equal(compactionDepthOf(6, 32), 6)
  assert.equal(compactionDepthOf(0, 32), 32)
  assert.equal(compactionDepthOf(-1, 32), 32)
  assert.equal(compactionDepthOf(40, 32), 32)
})
