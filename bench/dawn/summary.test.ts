import assert from 'node:assert/strict'
import { test } from 'node:test'
import { COUNTS, type Counts } from './device.ts'
import type { FrameRecord } from './frames.ts'
import { emptyWork } from './passWorkHooks.ts'
import { benchPasses } from './benchPasses.ts'
import { countsPerFrame, passKey, passTimes, roundNumbers, spread } from './summary.ts'

const counts = (submits: number) =>
  ({ ...Object.fromEntries(COUNTS.map((key) => [key, 0])), submits }) as Counts

const frame = (gpuMs: number, sample: FrameRecord['sample'] = null): FrameRecord => ({
  drawn: true,
  gpu: {
    passes: [
      {
        label: 'Trillion3D temporal antialiasing',
        kind: 'render',
        ms: gpuMs,
        spanMs: gpuMs,
        gapMs: 0,
        beginMs: 0,
        state: 'ok',
        work: emptyWork(),
      },
    ],
    unionMs: gpuMs,
    gapMs: 0,
    windowMs: gpuMs,
    complete: true,
  },
  cpuMs: 2,
  wallMs: gpuMs,
  loopMs: 1,
  counts: counts(1),
  engineCpuMs: 1,
  engineGpuMs: gpuMs - 1,
  sample,
  counters: {},
})

const sample = (frameNumber: number, passes: [string, number][]) => ({
  frame: frameNumber,
  totalMs: null,
  truncated: false,
  passes: passes.map(([name, ownMs]) => ({ name, gpuMs: ownMs + 1, ownMs })),
})

test('a spread reads the median, the 95th percentile and the extremes, ignoring what is not a number', () => {
  assert.deepEqual(spread([3, 1, 2, Number.NaN]), {
    median: 2,
    p95: 3,
    min: 1,
    max: 3,
    n: 3,
    mean: 2,
    iqr: 1,
    std: Math.sqrt(2 / 3),
  })
  assert.equal(spread([Number.NaN]), null)
})

test('a pass’s batches are one pass, and the engine’s prefix is left out', () => {
  assert.equal(passKey('vsm.render.raster 12'), 'vsm.render.raster *')
  assert.equal(passKey('Trillion3D temporal antialiasing'), 'temporal antialiasing')
})

test('passes are timed once per sampled image, by their own time, absent ones as zero', () => {
  const a = sample(10, [
    ['Trillion3D temporal antialiasing', 3],
    ['vsm.render.raster 1', 1],
    ['vsm.render.raster 2', 1],
  ])
  const b = sample(11, [['Trillion3D temporal antialiasing', 5]])
  // The first sample is read by two frames: it counts once.
  const times = passTimes([frame(10, a), frame(10, a), frame(12, b)])
  assert.equal(times.samples, 2)
  const raster = times.passes.find((pass) => pass.name === 'vsm.render.raster *')!
  assert.deepEqual([raster.min, raster.max, raster.stage], [0, 2, 'shadows'])
  assert.equal(times.passes[0].name, 'temporal antialiasing')
})

test('a segment counts the frames over twice its median as hitches', () => {
  const round = roundNumbers([frame(10), frame(10), frame(11), frame(40)])
  assert.equal(round.gpuMs?.median, 10.5)
  assert.deepEqual(round.hitchFrames, [3])
  assert.equal(round.heldFrom, null)
  assert.equal(roundNumbers([frame(10), { ...frame(10), drawn: false }]).heldFrom, 1)
  assert.equal(round.worstGpuMs, 40)
  assert.equal(round.cpuMs?.median, 2)
  assert.equal(countsPerFrame([frame(10)]).submits, 1)
})

test('the bench timer reads every pass of each frame by label, its batches as one, absent ones as zero', () => {
  const passes = benchPasses([
    frame(4),
    {
      ...frame(6),
      gpu: {
        passes: [
          {
            label: 'vsm.render.raster 3',
            kind: 'render',
            ms: 2,
            spanMs: 2,
            gapMs: 0,
            beginMs: 0,
            state: 'ok',
            work: { ...emptyWork(), invocations: 100, boundBytes: 1000 },
          },
          {
            label: 'vsm.render.raster 4',
            kind: 'render',
            ms: 4,
            spanMs: 4,
            gapMs: 0.5,
            beginMs: 2,
            state: 'ok',
            work: { ...emptyWork(), invocations: 100, boundBytes: 1000 },
          },
        ],
        unionMs: 6,
        gapMs: 0.5,
        windowMs: 6.5,
        complete: true,
      },
    },
    // A frame the engine timed itself is left out: its passes carry the engine's timestamps.
    { ...frame(9), gpu: { passes: [], unionMs: 0, gapMs: 0, windowMs: 0, complete: false } },
  ])
  const rasters = passes.filter((pass) => pass.name === 'vsm.render.raster *')
  assert.equal(rasters.length, 1)
  assert.deepEqual([rasters[0].min, rasters[0].max, rasters[0].stage], [0, 6, 'shadows'])
  assert.equal(passes.find((pass) => pass.name === 'temporal antialiasing')!.n, 2)
  assert.deepEqual(
    [rasters[0].encoded.invocations, rasters[0].encoded.boundBytes],
    [100, 1000],
    'the encoded work is read per frame, batches added',
  )
  assert.equal(rasters[0].waitMs, 0.25, 'the wait before a pass is told apart from its work')
})
