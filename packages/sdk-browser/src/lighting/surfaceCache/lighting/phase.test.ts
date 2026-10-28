// The lighting's stochastic phase counts from the image the light began, in every pass that turns on it (screen probes, occlusion, shadows, subsurface, the shading's jitter word, the graph frame's noise).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lightingPhase } from './phase.ts'
import { noiseFrame } from '../../../frame/render/noiseFrame.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

/** A world with a temporal state of its own (rank `sample`) at image `frame`, its light begun at `begunAt` or not yet. */
const world = (frame: number, sample: number, begunAt?: number) =>
  ({
    run: { frame },
    lights: { buffer: {}, store: { unlit: false } },
    gpu: { temporal: { frame: { stochasticSample: sample } } },
    surfaceCache: { lighting: begunAt === undefined ? {} : { begunAt } },
  }) as unknown as WebgpuPagesRuntime

test('the phase is the noise’s clock: zero before the light begins, the images since its start after, whatever the view’s own rank', () => {
  assert.equal(lightingPhase(world(7, 7)), 0, 'the light will begin: zero meanwhile')
  assert.equal(lightingPhase(world(12, 12, 10)), 2)
  assert.equal(lightingPhase(world(12, 500, 10)), 2, 'the view’s rank is its own')
  assert.equal(lightingPhase(world(9, 9, 10)), 0, 'never below zero')
  assert.equal(
    lightingPhase({ gpu: {}, run: { frame: 0 } } as unknown as WebgpuPagesRuntime),
    0,
    'no temporal state, no cache: the image number',
  )
})

test('a temporal state made again leaves the phase where it is: one clock for the image', () => {
  const rt = world(40, 40, 40)
  assert.equal(lightingPhase(rt), 0)
  const temporal = rt.gpu.temporal!.frame
  temporal.stochasticSample = 3
  assert.equal(lightingPhase(rt), 0, 'the state restarted at a lower rank')
  rt.run.frame = 42
  assert.equal(lightingPhase(rt), 2, 'and the phase goes on with the images')
  assert.equal(lightingPhase(rt), noiseFrame(rt), 'the shading reads the same clock')
})

test('a view with no temporal state takes the noise’s clock: its phase moves with the images', () => {
  const at = (frame: number) =>
    ({
      run: { frame },
      lights: { buffer: {}, store: { unlit: false } },
      gpu: {},
      surfaceCache: { lighting: { begunAt: 10 } },
    }) as unknown as WebgpuPagesRuntime
  assert.deepEqual([at(10), at(11), at(15)].map(lightingPhase), [0, 1, 5])
})

test('the screen probes, the occlusion, the shadows and the subsurface read the phase of the lighting, never the absolute rank', () => {
  for (const path of [
    '../../bounce/screen/frame.ts',
    '../../ao/frame.ts',
    '../../shadows/vsm/frame/vsmProject.ts',
    '../../subsurface/frame.ts',
    '../../../frame/render/render.ts',
    '../../../frame/render/surfaceLighting.ts',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /lightingPhase\(rt\)/, path)
    assert.doesNotMatch(source, /stochasticPhase\(/, path)
  }
})

test('the occlusion’s horizon noise turns on the lighting phase, its history age on the image number', () => {
  assert.match(
    readFileSync(new URL('../../ao/horizon/params.ts', import.meta.url), 'utf8'),
    /pauseJitter \? 0 : image\.noiseIndex/,
  )
  assert.match(
    readFileSync(new URL('../../subsurface/frame.ts', import.meta.url), 'utf8'),
    /image\.frame = lightingPhase\(rt\)/,
  )
})

test('the translucency volume’s noise and the feedback’s place in its tile count from the light’s start', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  assert.match(read('../../translucencyGi/image.ts'), /IMAGE\.frame = lightingPhase\(rt\)/)
  assert.match(
    read('../feedbackBuffer.ts'),
    /feedbackTileJitter\(Math\.max\(0, cache\.feedbackFrame - from\), tile\)/,
  )
  assert.match(
    read('../../reflections/frame.ts'),
    /feedback\.begin\(writes\.cache, gpu\.targetSize, rt\.surfaceCache\?\.lighting\?\.begunFeedback\)/,
  )
})
