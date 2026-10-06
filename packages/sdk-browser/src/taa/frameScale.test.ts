import test from 'node:test'
import assert from 'node:assert/strict'
import { IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts'
import { beginTaaFrame, convergeStillPhase, taaSettled } from './frame.ts'
import { restartTaaOnLanding } from './landing.ts'
import { taaJitter, taaStillFrames, upscalePhases } from './jitter.ts'
import { renderExtent, type RenderScale } from '../frame/renderScaleOption.ts'
import { createTaaFrameState } from './frameState.ts'
import { createScaleControl } from '../frame/scaleControl.ts'
import { HZ120, lowered } from '../frame/scaleFit.fixture.ts'
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts'
import type { EngineCamera } from '../camera/world.ts'

const DISPLAY = [3456, 2234],
  clock = { now: 0, frame: 0 }
/** A view drawn under the bounds {0.5; 1}, its controller dropped to about 0.6 by a 20 ms frame
 *  at 120 Hz; or under `option`, on `display`. */
function runtime(option: RenderScale = { min: 0.5, max: 1 }, display = DISPLAY) {
  const scale = createScaleControl(option)
  lowered(scale, 20, clock)
  const rt = {
    gpu: {
      temporal: { frame: createTaaFrameState(), checkpoint() {}, replay: () => false },
      temporalWanted: true,
      targetSize: [...display],
      allocatedSize: [...display],
      displaySize: display,
      colorTexture: {},
      displayTexture: {},
    },
    vis: {},
    scale,
    run: {
      diagnostic: 'beauty',
      frame: 0,
      textureConverging: false,
      gate: { temporalRevision: 0 },
    },
    capture: { capturing: false },
  } as unknown as WebgpuPagesRuntime
  return { rt, moving: scale.wanted() }
}

const cam = { viewProjection: IDENTITY_MATRIX4, eye: [0, 0, 0] } as unknown as EngineCamera

// A still image is drawn at the controller's scale, the budget's, as a moving one; the
// targets stay made at the bounds' maximum.
test('a moving and a quiet image draw at the controller, a convergence at its image', () => {
  const { rt, moving } = runtime()
  assert.ok(moving < 1)
  beginTaaFrame(rt, cam, false)
  assert.equal(rt.scale.drawn, moving)
  assert.ok(rt.gpu.targetSize[0] < DISPLAY[0], 'drawn below the display')
  assert.equal(rt.scale.steered, true, 'the moving image is what the controller measures')
  rt.run.textureConverging = true
  beginTaaFrame(rt, cam, true)
  assert.equal(rt.scale.drawn, moving, 'the convergence remakes the moving image at its scale')
  assert.equal(rt.scale.steered, false, 'a convergence image is not measured')
  rt.run.textureConverging = false
  beginTaaFrame(rt, cam, true)
  assert.equal(rt.scale.drawn, moving, 'the quiet image is drawn at the controller too')
  assert.deepEqual([rt.scale.steered, rt.scale.still], [true, true], 'and measured, as still')
  assert.equal(rt.scale.allocated(), 1, "in targets made at the bounds' maximum")
  rt.capture.capturing = true
  beginTaaFrame(rt, cam, false)
  assert.deepEqual([rt.scale.drawn, rt.gpu.targetSize], [1, DISPLAY], 'no accumulation, no scale')
})

// A capture after a moving camera converged at the moving image's scale and jitter, so it
// made resident what that image reads; the held image, drawn at the display over eight other
// phases, read slivers nothing had asked for. The convergence branch itself draws a capture's
// barrier at the still scale, one phase after another (`stillPhase`); another barrier replays.
test("a capture's barrier converges at the still image's scale, phase after phase", () => {
  const { rt, moving } = runtime()
  beginTaaFrame(rt, cam, false)
  const frame = rt.gpu.temporal!.frame
  rt.run.textureConverging = true
  beginTaaFrame(rt, cam, false)
  assert.equal(rt.scale.drawn, moving, 'a barrier that takes no picture replays the image')
  lowered(rt.scale, 40, clock)
  assert.ok(rt.scale.wanted() < moving, 'the controller dropped since')
  convergeStillPhase(rt, 0)
  beginTaaFrame(rt, cam, false)
  assert.equal(rt.scale.drawn, rt.scale.wanted(), "the still image's: the controller's")
  const replayed = [...frame.jitter]
  for (let phase = 1; phase < frame.phases; phase++) {
    convergeStillPhase(rt, phase)
    beginTaaFrame(rt, cam, false)
    const expected = taaJitter(frame.sample + phase, new Float64Array(2), frame.phases)
    assert.deepEqual([...frame.jitter], [...expected], `phase ${phase}`)
    assert.notDeepEqual([...frame.jitter], replayed)
  }
  convergeStillPhase(rt, null)
  rt.run.textureConverging = false
})

// A tile or a shadow page landing on a still frame mixed two residencies in one
// average, at a time the readback decided. The average restarts on it, from phase zero.
test('a landing on a still image restarts its average; nothing landed, or moving, keeps it', () => {
  const { rt } = runtime()
  const frame = rt.gpu.temporal!.frame
  for (let image = 0; image < 3; image++) beginTaaFrame(rt, cam, true)
  assert.equal(frame.stillFrames, 3)
  restartTaaOnLanding(rt, 0)
  assert.equal(frame.stillFrames, 3, 'nothing landed')
  restartTaaOnLanding(rt, 2)
  assert.deepEqual([frame.stillFrames, frame.hasHistory], [0, false])
  frame.sample = 5
  beginTaaFrame(rt, cam, true)
  assert.deepEqual([frame.stillFrames, frame.sample], [1, 0], 'the next image restarts at phase 0')
  beginTaaFrame(rt, cam, false)
  restartTaaOnLanding(rt, 4)
  assert.equal(frame.stillFrames, 0, 'a moving image has no still average to restart')
})

/** Draws quiet images on `rt` until it holds (`taaSettled`), the display at 120 Hz and each image's
 *  GPU time `gpuMs(image)` read back at once; returns the scale of each image drawn, those that
 *  restarted the average — no history, phase zero —, and the draws of each phase. What the pass
 *  does once encoded (`encodeTaaPass`) is done here: the next phase, a history. */
function rest(rt: WebgpuPagesRuntime, gpuMs: (image: number) => number = () => 1) {
  const frame = rt.gpu.temporal!.frame,
    scales: number[] = [],
    restarts: number[] = [],
    drawn: number[] = []
  for (let image = 0; !taaSettled(rt); image++) {
    assert.ok(image < 1000, 'never holds')
    rt.scale.tick((clock.now += HZ120), true)
    beginTaaFrame(rt, cam, true)
    scales.push(rt.scale.drawn)
    if (frame.stillFrames === 1 && !frame.hasHistory && frame.sample === 0) restarts.push(image)
    drawn[frame.sample] = (drawn[frame.sample] ?? 0) + 1
    rt.scale.observe(gpuMs(image), rt.scale.drawn, rt.scale.steered)
    frame.sample = (frame.sample + 1) % frame.phases
    frame.hasHistory = true
  }
  return { scales, restarts, drawn }
}

// The hold came one image short of the cycles (`taaSettled`): at native size the eleventh
// phase held five draws of sixty-five, every other six — a still average not uniform.
test('a still average holds after whole cycles of its scale, every phase drawn as often', () => {
  for (const option of [1, 0.75, 0.5, undefined]) {
    const { rt, moving } = runtime(option),
      frame = rt.gpu.temporal!.frame,
      { drawn } = rest(rt)
    const cycles = taaStillFrames(frame.phases) / frame.phases
    assert.equal(frame.phases, upscalePhases(renderExtent(DISPLAY[0], moving), DISPLAY[0]))
    assert.equal(frame.stillFrames, taaStillFrames(frame.phases), `scale ${option}`)
    assert.deepEqual(drawn, new Array(frame.phases).fill(cycles), `scale ${option}: uniform`)
  }
})

// The still image was drawn at the bounds' maximum, above the frame's budget, for as long
// as the average took. It is drawn at the controller's scale, which still images never raise —
// a rise would restart the average.
test('at rest no image is drawn above the budget scale; motion after it is unchanged', () => {
  const { rt, moving } = runtime()
  const { scales, restarts } = rest(rt)
  assert.deepEqual(restarts, [0], 'one average, from the first still image')
  assert.deepEqual(new Set(scales), new Set([moving]), 'cheap still images raise nothing')
  beginTaaFrame(rt, cam, false)
  assert.deepEqual([rt.scale.drawn, rt.scale.steered], [moving, true], 'motion: unchanged')
  const fixed = runtime(0.6).rt
  beginTaaFrame(fixed, cam, true)
  assert.equal(fixed.scale.drawn, 0.6, 'a fixed scale draws its own, calm')
  beginTaaFrame(fixed, cam, false)
  assert.equal(fixed.scale.drawn, 0.6, 'and moving')
})

// A still average is of one scale; the controller lowering it restarts the average.
test('a still image the controller lowers restarts its average cleanly at the new scale', () => {
  const { rt, moving } = runtime(),
    frame = rt.gpu.temporal!.frame
  // The tenth and eleventh still images cost over twice the 120 Hz frame: the controller drops.
  const { scales, restarts } = rest(rt, (image) => (image === 9 || image === 10 ? 20 : 1)),
    lower = rt.scale.wanted(),
    first = scales.indexOf(lower)
  assert.ok(lower < moving, `${lower}`)
  assert.equal(first, 11, 'the next image draws at the new scale')
  assert.deepEqual(restarts, [0, first], 'and restarts there: no history, phase zero')
  assert.deepEqual(new Set(scales.slice(0, first)), new Set([moving]))
  assert.deepEqual(new Set(scales.slice(first)), new Set([lower]), 'then at the new one only')
  const phases = upscalePhases(renderExtent(DISPLAY[0], lower), DISPLAY[0])
  assert.equal(frame.phases, phases)
  assert.equal(scales.length - first, taaStillFrames(phases), 'whole cycles of the new scale')
})

// A scale drawn at the same size — eighths of the display, `renderExtent` — draws the same phases
// on the same grid: the average goes on; another size restarts it.
test('a scale change that keeps the drawn size keeps the still average', () => {
  const { rt } = runtime(0.6, [100, 100]),
    frame = rt.gpu.temporal!.frame
  for (let image = 0; image < 3; image++) beginTaaFrame(rt, cam, true)
  rt.scale.set(0.62)
  beginTaaFrame(rt, cam, true)
  assert.deepEqual([frame.stillFrames, rt.scale.drawn], [4, 0.62], '64 pixels either way')
  rt.scale.set(0.5)
  beginTaaFrame(rt, cam, true)
  assert.deepEqual([frame.stillFrames, frame.sample, frame.hasHistory], [1, 0, false], '48')
})
