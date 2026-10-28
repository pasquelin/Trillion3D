// The light begins once its inputs are ready, and from that image the noise's phases count from zero: the cache's dither (`noiseFrame`) and
// the stochastic rank of the view (`stochasticSample`) agree between two worlds of one scene, whatever the images drawn before.
import test from 'node:test'
import assert from 'node:assert/strict'
import { beginLighting } from './beginLighting.ts'
import { lightingPhase } from './phase.ts'
import { beginNoiseImage, noiseFrame } from '../../../frame/render/noiseFrame.ts'
import { createFrameHold } from '../../../frame/revisions.ts'
import { createTaaFrameState, STOCHASTIC_SLOTS } from '../../../post/taa/frameState.ts'
import { LIGHTING_PARAMS } from './layout.ts'
import { combineWgsl } from './combineWgsl.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'
import { writeLightingParams, shapeOf } from './params.ts'
import { lightingImage, lightingSettings } from './params.fixture.ts'
import type { SurfaceLightingState } from './surfaceLighting.ts'
import type { WebgpuPagesRuntime } from '../../../frame/backend/runtime.ts'

// A world with the lighting's inputs ready (`lightInputsReady` with nothing to wait for), at image `frame`, its stochastic rank `sample`.
const world = (frame: number, sample: number) =>
  ({
    run: { frame, textureConverging: false },
    lights: {
      store: { shadowedSuns: 0, shadowedLocals: 0, unlit: false, count: 0 },
      vsm: undefined,
      vsmRefusal: false,
    },
    vis: {},
    context: {},
    gpu: { temporal: { frame: { stochasticSample: sample } } },
    surfaceCache: {},
  }) as unknown as WebgpuPagesRuntime

test('the lighting records the view’s stochastic rank at the image it begins, and its phase counts from there without the counter moving', () => {
  const state = () => ({ begun: false }) as SurfaceLightingState
  const cold = world(11, 11),
    warm = world(10, 10)
  const a = state(),
    b = state()
  cold.surfaceCache!.lighting = a
  warm.surfaceCache!.lighting = b
  assert.equal(beginLighting(cold, a), true)
  assert.equal(beginLighting(warm, b), true)
  assert.equal(cold.gpu.temporal!.frame.stochasticSample, 11, 'the view’s counter is its own')
  assert.equal(lightingPhase(cold), 0)
  assert.equal(lightingPhase(warm), 0)
  // Two images later in both worlds: the same phase.
  for (const rt of [cold, warm]) {
    rt.run.frame += 2
    rt.gpu.temporal!.frame.stochasticSample += 2
    assert.equal(beginLighting(rt, rt.surfaceCache!.lighting!), true)
  }
  assert.equal(lightingPhase(cold), 2)
  assert.equal(lightingPhase(warm), 2)
  assert.equal(noiseFrame(cold), noiseFrame(warm))
})

test('the light records the feedback clock at the image it begins, the place of the feedback in its tile counting from there', () => {
  const rt = world(11, 11)
  ;(rt.surfaceCache as { cache?: { feedbackFrame: number } }).cache = { feedbackFrame: 9 }
  const state = { begun: false } as SurfaceLightingState
  rt.surfaceCache!.lighting = state
  assert.equal(beginLighting(rt, state), true)
  assert.equal(state.begunFeedback, 9)
})

test('the cache’s output dither turns on the noise’s clock, never on the update clock', () => {
  const words = new Uint32Array(LIGHTING_PARAMS.words)
  writeLightingParams(
    words,
    shapeOf(lightingSettings, 1024, false, WORD_LIGHT_FORMAT),
    lightingSettings,
    lightingImage({ frame: 265, noiseFrame: 5 }),
  )
  assert.equal(words[LIGHTING_PARAMS.at.frame], 265)
  assert.equal(words[LIGHTING_PARAMS.at.noiseFrame], 5)
  const text = combineWgsl(false, WORD_LIGHT_FORMAT)
  assert.match(text, /lp\.noiseFrame%8u/)
  assert.doesNotMatch(text, /lp\.frame%8u/)
})

test('a light that begins while the cut encodes, then the final image anchored after it: the image the light began on counts zero, the held image too', () => {
  const revisions = { scene: 0, view: 0, resources: 0 },
    hold = createFrameHold(1)
  const rt = world(1, 0) as WebgpuPagesRuntime & { run: { frame: number; gate: unknown } }
  rt.run.gate = { revisions, hold } as unknown as typeof rt.run.gate
  Object.assign(rt.lights, { buffer: {} })
  Object.assign(rt.gpu, { temporal: { frame: createTaaFrameState() } })
  const lighting = { begun: false } as SurfaceLightingState
  rt.surfaceCache!.lighting = lighting
  /** One image as the frame entry plays it: the hold's decision, the cut (the light may begin), the advance of the number, the frame kept. */
  const image = () => {
    const wanted = beginNoiseImage(rt, true, true)
    const before = noiseFrame(rt)
    beginLighting(rt, lighting)
    const after = noiseFrame(rt)
    const at = rt.run.frame++
    rt.gpu.temporal!.frame.stochasticSample++
    hold.keep(revisions)
    return { wanted, before, after, at }
  }
  const first = image()
  assert.deepEqual(
    [first.before, first.after],
    [0, 0],
    'the light begins on the first image, at the number its decision took',
  )
  assert.equal(lighting.begunAt, 1)
  // The light having begun is a change of the next image: its establishment goes through a cycle of the noise.
  assert.equal(image().wanted, false, 'the image the light is seen to have begun on')
  for (let k = 2; k <= STOCHASTIC_SLOTS; k++)
    assert.equal(image().wanted, true, 'drawn for the clock within the cycle of the last change')
  const final = image()
  assert.deepEqual(
    [final.wanted, final.before, final.after],
    [true, 0, 0],
    'the final image: canonical before and after the cut',
  )
  assert.equal(lighting.begunAt, 1, 'the light does not begin again')
  assert.equal(image().wanted, false, 'then the view is held')
})
