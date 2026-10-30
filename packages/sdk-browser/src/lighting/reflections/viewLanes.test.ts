// The lanes of the reflection's view uniform a still frame writes: a ray's budget and stages, the settings of
// the trace and the denoiser with their level's row, and the biases of a ray through the scene's triangles.
// Split from `viewWrite.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { REFLECTION_COUNTS } from './constants.ts'
import { REFLECTION_VIEW_AT } from './viewLayout.ts'
import { stillView } from './viewWrite.fixture.ts'
import { stageReflectionImage } from './image.ts'
import type { ReflectionFrame } from './viewWrite.ts'
import {
  REFLECTION_RULES,
  resolveReflections,
} from '../../../../sdk-core/src/contracts/reflectionOptions.ts'
import { resolveSettings } from '../../../../sdk-core/src/contracts/settingRules.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'

/** The reflections' settings the options give, over the screen probes' the options give too. */
const reflections = (options: object) =>
  resolveReflections(resolveSettings(REFLECTION_RULES, options), screenProbeSettings(options))

/** The flags of what a view does besides the stages of the trace: every one on by default. */
const DONE =
  REFLECTION_COUNTS.REFLECTION_SCREEN_TRACES |
  REFLECTION_COUNTS.REFLECTION_TEMPORAL |
  REFLECTION_COUNTS.REFLECTION_RECONSTRUCTION |
  REFLECTION_COUNTS.REFLECTION_BILATERAL |
  REFLECTION_COUNTS.REFLECTION_SCENE_COLOR |
  REFLECTION_COUNTS.REFLECTION_HEIGHT_FOG |
  REFLECTION_COUNTS.REFLECTION_HI_RES_SURFACE
const SCENE = REFLECTION_COUNTS.REFLECTION_SCENE_TRACES
const DISTANT = REFLECTION_COUNTS.REFLECTION_DISTANT_TRACES

/** The lanes of the view a still frame writes, each as four words (`uints` as they are, the others as floats). */
function lanesOf(extra: object) {
  const { sent, write, held, frame } = stillView(extra)
  write(frame, held)
  const words = (field: keyof typeof REFLECTION_VIEW_AT) =>
    sent.bits.slice(REFLECTION_VIEW_AT[field], REFLECTION_VIEW_AT[field] + 4)
  const floats = (field: keyof typeof REFLECTION_VIEW_AT) => {
    const lane = words(field)
    return [...new Float32Array(lane.buffer, lane.byteOffset, 4)].map((x) => Math.fround(x))
  }
  return { words, floats }
}

test('a ray’s budget and stages travel with the view: the reference’s by default, the settings’ otherwise', () => {
  const lanes = (extra: object) => {
    const { words, floats } = lanesOf(extra)
    return [[...words('scene')], floats('reach')]
  }
  const { scene, reach } = { scene: 0, reach: 1 }
  // The fourth word is the front layer's own flags (`frontSceneTraces` and its four neighbours), asserted apart.
  const opaque = (extra: object) => lanes(extra)[scene].slice(0, 3)
  // 50 iterations of the screen and 16 steps of the far trace; the scene and the far trace on; 5 cm a ray leaves a
  // surface by, and 2 km the far trace's length.
  const every = lanes({})
  assert.deepEqual(opaque({}), [50, 16, SCENE | DISTANT | DONE])
  assert.equal(
    every[scene][3],
    SCENE | DISTANT | DONE,
    'the front layer, by default, does what the opaque one does',
  )
  assert.deepEqual(
    every[reach],
    [0.05, 2000, 0.4, 10000].map(Math.fround),
    'the scene’s extent bounds no ray: the longest ray alone does; the foliage pixels’ roughness bar and the bilateral filter’s depth weight scale ride beside them',
  )
  const asked = (options: object) => ({ settings: reflections(options) })
  assert.deepEqual(opaque(asked({ reflectionScreenSteps: 20, reflectionDistantScreenSteps: 8 })), [
    20,
    8,
    SCENE | DISTANT | DONE,
  ])
  assert.deepEqual(
    opaque(asked({ screenProbeSceneTraces: false })),
    [50, 16, DISTANT | DONE],
    'the scene trace off',
  )
  assert.deepEqual(opaque(asked({ reflectionDistantScreenTraces: false })), [50, 16, SCENE | DONE])
  // The far trace needs the screen: with the screen traces off neither is on.
  assert.deepEqual(opaque(asked({ reflectionScreenTraces: false })), [
    50,
    16,
    (SCENE | DONE) &
      ~REFLECTION_COUNTS.REFLECTION_SCREEN_TRACES &
      ~REFLECTION_COUNTS.REFLECTION_SCENE_COLOR,
  ])
  // The surface bias is the screen probes' own, and travels with them.
  assert.equal(lanes(asked({ screenProbeSurfaceBias: 0.2 }))[reach][0], Math.fround(0.2))
  assert.equal(
    lanes(asked({ reflectionMaxRoughnessToTraceForFoliage: 0.2 }))[reach][2],
    Math.fround(0.2),
  )
})

test('the reference’s settings of the trace and the denoiser travel with the view, its level’s row too', () => {
  const lanes = (options: object) => lanesOf({ settings: reflections(options) })
  const every = lanes({})
  // The march: 0.5 % of the depth for a surface, the far trace's slope tolerance 2 and offset bias 0, rays 200 m long.
  assert.deepEqual(every.floats('march'), [0.005, 2, 0, 200].map(Math.fround))
  // The ceiling of a ray 40, the lit image taken within 1 % of the depth and 85°, the sky fogged over 1 000 m.
  assert.deepEqual(
    every.floats('light'),
    [40, 0.01, Math.cos((85 * Math.PI) / 180), 1000].map(Math.fround),
  )
  // The history's 12 images, the clamp's scale 1, the distance threshold 0.03, the tonemap range 10.
  assert.deepEqual(every.floats('denoise'), [12, 1, 0.03, 10].map(Math.fround))
  // The reconstruction's radius 8, the bilateral filter's 8, the least weight of the level 0, 2 frames of disocclusion.
  assert.deepEqual(every.floats('spread'), [8, 8, 0, 2])
  // The bilateral filter's depth weight scale, 10 000, the reach lane's last word.
  assert.equal(every.floats('reach')[3], 10000)
  assert.equal(
    lanes({ reflectionBilateralDepthWeightScale: 500 }).floats('reach')[3],
    500,
    'the setting’s',
  )
  // The disocclusion frames never pass the images a history holds; zero turns the boost off.
  assert.equal(lanes({ reflectionMaxFramesAccumulated: 1 }).floats('spread')[3], 1)
  assert.equal(lanes({ reflectionBilateralDisocclusionFrames: 0 }).floats('spread')[3], 0)
  // Roughness 0.4 and its fade 0.1, the sampling's bias 0.1.
  assert.deepEqual(every.floats('lobe'), [0.4, 0.1, 0.1, 0].map(Math.fround))
  // The level 'ultra' (the default): a ray a pixel, five neighbours for the reconstruction and four for the filter; the period of the ray directions is the CPU's.
  assert.deepEqual([...every.words('taps')], [5, 4, 0, 0])
  // The filter's neighbours are held to 1 024, whatever the setting asks; 0 reads none.
  assert.equal(lanes({ reflectionBilateralSamples: 1024 }).words('taps')[1], 1024)
  assert.equal(lanes({ reflectionBilateralSamples: 5000 }).words('taps')[1], 1024)
  assert.equal(lanes({ reflectionBilateralSamples: 0 }).words('taps')[1], 0)
  assert.equal(
    lanes({}).words('taps')[2],
    0,
    'the screen march is never given up for want of lanes',
  )
  assert.equal(lanes({ reflectionScreenMinimumOccupancy: 8 }).words('taps')[2], 8)
  assert.deepEqual([...every.words('grid').slice(0, 3)], [64, 32, 1])
  // The level 'high': a ray a block of 2 × 2, three neighbours, the least weight 1; 'off': no lobe traces.
  const high = lanes({ reflectionQuality: 'high' })
  assert.deepEqual([...high.words('grid').slice(0, 3)], [32, 16, 2])
  assert.equal(high.words('taps')[0], 3)
  assert.equal(high.floats('spread')[2], 1)
  assert.equal(high.floats('reach')[2], Math.fround(0.2), 'its foliage bar, the level’s row')
  // The checkerboard keeps the blocks one pixel high; a quality scale of 0.25 doubles the default level's blocks, above 1 it raises
  // the neighbours' rays (the level's five times the scale, at most 64); the smooth bias rides the lobe's last word.
  assert.deepEqual(
    [...lanes({ reflectionDownsampleCheckerboard: true }).words('grid')],
    [64, 32, 1, 1],
  )
  const checker = lanes({ reflectionQuality: 'high', reflectionDownsampleCheckerboard: true })
  assert.deepEqual([...checker.words('grid')], [32, 32, 2, 1])
  assert.deepEqual([...lanes({ reflectionQualityScale: 0.25 }).words('grid')], [32, 16, 2, 2])
  assert.equal(lanes({ reflectionQualityScale: 2 }).words('taps')[0], 10)
  assert.equal(lanes({ reflectionQualityScale: 100 }).words('taps')[0], 64)
  assert.equal(lanes({ reflectionSmoothBias: 0.3 }).floats('lobe')[3], Math.fround(0.3))
  assert.equal(lanes({ reflectionQuality: 'off' }).floats('lobe')[0], 0)
  assert.equal(lanes({ reflectionQuality: false }).floats('lobe')[0], 0, 'false is off')
  assert.equal(
    lanes({ reflectionQuality: true }).floats('lobe')[0],
    Math.fround(0.4),
    'true the default level',
  )
})

test('a ray through the scene’s triangles travels with the view: its biases in metres, the cards’ depth bias the image’s scene trace gives in centimetres', () => {
  const lanes = (extra: object) => lanesOf(extra).floats('hardware')
  // 0.1 cm along the ray, 0.1 cm off the surface, 8 cm of pullback; no scene trace, no depth bias.
  assert.deepEqual(lanes({ settings: reflections({}) }), [0.001, 0.001, 0.08, 0].map(Math.fround))
  assert.deepEqual(
    lanes({
      settings: reflections({
        reflectionHardwareRayTracingBias: 0.5,
        reflectionHardwareRayTracingNormalBias: 2,
        hardwareRayTracingPullbackBias: 0.2,
      }),
      cardDepthBias: 10,
    }),
    [0.005, 0.02, 0.2, 10].map(Math.fround),
  )
})

test('the first-person stand-ins travel with the view: their sphere in the world, none when the scene has no stand-in, and the least distance a ray is handed off at in metres', () => {
  const lanes = (extra: object) => {
    const { sent, write, held, frame } = stillView(extra)
    write(frame, held)
    return {
      sphere: [...new Float32Array(sent.words.buffer, sent.words.byteOffset, sent.words.length)]
        .slice(REFLECTION_VIEW_AT.firstPerson, REFLECTION_VIEW_AT.firstPerson + 4)
        .map(Math.fround),
      minimum: sent.words[REFLECTION_VIEW_AT.firstPersonMinimum],
    }
  }
  // 4 cm by default, no sphere.
  assert.deepEqual(lanes({ settings: reflections({}) }), {
    sphere: [0, 0, 0, 0],
    minimum: Math.fround(0.04),
  })
  assert.deepEqual(
    lanes({
      settings: reflections({ reflectionHardwareRayTracingFirstPersonMinimumHitDistance: 10 }),
      firstPerson: [1, 2, 3, 0.5],
    }),
    { sphere: [1, 2, 3, 0.5], minimum: Math.fround(0.1) },
  )
})

test('the opaque surface’s spatial filter is part of its temporal pass: with the temporal pass off the filter is off too, the front layer’s keeps its own', () => {
  const flags = (options: object) => lanesOf({ settings: reflections(options) }).words('scene')
  const bilateral = REFLECTION_COUNTS.REFLECTION_BILATERAL
  assert.ok((flags({})[2] & bilateral) !== 0 && (flags({})[3] & bilateral) !== 0)
  const noTemporal = flags({ reflectionTemporal: false })
  assert.equal(noTemporal[2] & bilateral, 0)
  assert.notEqual(
    noTemporal[3] & bilateral,
    0,
    'the translucent surfaces’ denoiser filters whatever its temporal pass does',
  )
})

test('the ceiling of a ray, in the display’s white, is divided by the image’s pre-exposure: the radiance a ray holds is not yet multiplied by it', () => {
  const ceiling = (preExposure?: number) =>
    lanesOf({ settings: reflections({}), preExposure }).floats('light')[0]
  assert.equal(ceiling(), 40, 'none: the setting')
  assert.equal(ceiling(0.25), 160)
  assert.equal(ceiling(4), 10)
})

test('the exposure the hit lighting’s lights are strengthened under travels in the view, each view its own', () => {
  const exposure = (value?: number) =>
    lanesOf({ settings: reflections({}), exposure: value }).floats('radiance')[2]
  assert.equal(exposure(), 1, 'none: unit')
  assert.equal(exposure(0.5), 0.5)
  assert.equal(exposure(8), 8)
})

test('the view tells whether the screen is traced against a lit image no cut has made another, and whether the depth kept is that image’s', () => {
  const traced = (extra: object) => {
    const { sent, write, held, frame } = stillView(extra)
    write(frame, held)
    return [sent.bits[REFLECTION_VIEW_AT.traced], sent.bits[REFLECTION_VIEW_AT.traced + 1]]
  }
  assert.deepEqual(traced({}), [1, 0], 'a held image, no depth of its image')
  assert.deepEqual(traced({ depthKept: true }), [1, 1])
  assert.deepEqual(
    traced({ historyCut: true, depthKept: true }),
    [0, 1],
    'a cut of the view: no history',
  )
  assert.deepEqual(traced({ historyCut: false }), [1, 0])
})

test('the thickness of the depth test of a screen hit and the roughness scale of the reconstruction are the settings’, the thickness over the projection’s scale', () => {
  const scalars = (options: object) => {
    const { sent, write, held, frame } = stillView({ settings: reflections(options) })
    write(frame, held)
    const at = (field: 'historyThickness' | 'reconstructionScale') =>
      Math.fround(sent.words[REFLECTION_VIEW_AT[field]])
    return [at('historyThickness'), at('reconstructionScale')]
  }
  assert.deepEqual(scalars({}), [0.005, 1].map(Math.fround), 'the defaults: 0.5 % and 1')
  assert.deepEqual(
    scalars({
      reflectionHistoryDepthTestRelativeThickness: 0.02,
      reflectionReconstructionRoughnessScale: 2,
    }),
    [0.02, 2].map(Math.fround),
  )
})

test('the sky light’s leaking is one colour, the strength times its tint, with the albedo a hit reflects it by beside it', () => {
  const settings = reflections({
    reflectionSkylightLeaking: 0.5,
    reflectionSkylightLeakingTintRed: 1,
    reflectionSkylightLeakingTintGreen: 0.5,
    reflectionSkylightLeakingTintBlue: 0.25,
    reflectionSkylightLeakingAverageAlbedo: 0.4,
  })
  assert.deepEqual(
    settings.skylightLeakColor,
    [0.5, 0.25, 0.125],
    'the colour the screen probes take whole',
  )
  assert.equal(settings.skylightLeakAlbedo, 0.4, 'the albedo, applied by the reflections alone')
  assert.deepEqual(reflections({}).skylightLeakColor, [0, 0, 0], 'none by default')
})

test('a fixed state frame index holds the image’s index and the turn of the ray sequence at itself, else the index moves with the image and the turn with the sequence', () => {
  const staged = (options: object, frameIndex: number, turn: number) => {
    const reflection = {
      turn,
      images: 0,
      lit: { held: {} },
      writeView() {},
    } as unknown as Parameters<typeof stageReflectionImage>[0]
    const frame = { frameIndex, settings: reflections(options) } as ReflectionFrame
    stageReflectionImage(reflection, frame)
    return [frame.frameIndex, frame.turn]
  }
  assert.deepEqual(staged({}, 9, 3), [9, 4], 'none: the engine’s index, the next turn')
  assert.deepEqual(
    staged({ reflectionFixedStateFrameIndex: 13, reflectionMaxRayDirections: 8 }, 9, 3),
    [13, 5],
    'held: the index, and the turn it gives modulo the sequence',
  )
  assert.deepEqual(
    staged({ reflectionFixedStateFrameIndex: 0 }, 9, 3),
    [0, 0],
    'zero is an index, not none',
  )
})
