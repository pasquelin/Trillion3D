// The lighting's stochastic phase counts from the image the light began, in every pass that turns on it (screen probes, occlusion, shadows, subsurface, the shading's jitter word, the graph frame's noise).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { lightingPhase } from './phase.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

const world = (sample: number, begunSample?: number) =>
  ({
    run: { frame: sample },
    lights: { buffer: {}, store: { unlit: false } },
    gpu: { temporal: { frame: { stochasticSample: sample } } },
    surfaceCache: begunSample === undefined ? { lighting: {} } : { lighting: { begunSample } },
  }) as unknown as WebgpuPagesRuntime

test('the phase is the rank itself before the light begins, and counts from its start after', () => {
  assert.equal(lightingPhase(world(7)), 7)
  assert.equal(lightingPhase(world(12, 10)), 2)
  assert.equal(lightingPhase(world(9, 10)), 0, 'never below zero')
  assert.equal(
    lightingPhase({ gpu: {}, run: { frame: 0 } } as unknown as WebgpuPagesRuntime),
    0,
    'no temporal state, no cache: the image number',
  )
})

test('a rank below the start (the temporal state made again) re-anchors the start: the phase begins again from zero and goes on', () => {
  const rt = world(40, 40)
  assert.equal(lightingPhase(rt), 0)
  const temporal = rt.gpu.temporal!.frame
  temporal.stochasticSample = 3
  assert.equal(lightingPhase(rt), 0, 'the state restarted at a lower rank')
  temporal.stochasticSample = 5
  assert.equal(lightingPhase(rt), 2, 'and counts from there')
})

test('a view with no temporal state takes the noise’s clock: its phase moves with the images', () => {
  const at = (frame: number) =>
    ({
      run: { frame },
      lights: { buffer: {}, store: { unlit: false } },
      gpu: {},
      surfaceCache: { lighting: { begunAt: 10, begunSample: 0 } },
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
