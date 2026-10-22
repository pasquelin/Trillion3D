import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MeasuredWorld } from '../explorer.ts'
import { sessionOptions } from './options.ts'
import { worldSwitches } from './switches.ts'
import { effect } from '../../../../sdk-core/src/world/effect/index.ts'
import { DEFAULT_PIXEL_ERROR } from '../../../../sdk-core/src/lod/policy.ts'

/** No frame drawn yet. */
const unseen = { last: null }

/** An open session that records the switches written into it. */
function session() {
  const written: string[] = []
  const explorer = {
    setTemporalAntialiasing: (next: string) => void written.push(next),
  } as unknown as MeasuredWorld
  return { explorer, written }
}

// #363: `createWorld(…, { temporalAntialiasing: false })` opens its sessions with it off, and
// the property flips the open session in place, never reopening it.
test('temporal antialiasing is given to the session and switched in place', () => {
  const open = session()
  let renewed = 0,
    invalidated = 0
  const runtime = {
    explorer: null as MeasuredWorld | null,
    renew: () => void renewed++,
    invalidate: () => void invalidated++,
  }
  const options = { temporalAntialiasing: false }
  const switches = worldSwitches(options, () => runtime, unseen)
  assert.equal(sessionOptions(options, switches.held).temporalAntialiasing, 'off')
  assert.equal(switches.temporalAntialiasing, 'off', 'before a session: what the page asked')
  runtime.explorer = open.explorer
  switches.temporalAntialiasing = true
  switches.temporalAntialiasing = 'max'
  assert.deepEqual(open.written, ['max'], 'written once, into the open session')
  assert.equal(switches.temporalAntialiasing, 'max', 'the level resolved, the session open')
  assert.equal(sessionOptions(options, switches.held).temporalAntialiasing, 'max', 'kept on reopen')
  switches.temporalAntialiasing = 'medium'
  assert.deepEqual(open.written, ['max', 'medium'], 'another level, in place')
  assert.deepEqual([renewed, invalidated], [0, 2])
  assert.throws(() => (switches.temporalAntialiasing = 'fine' as never), /temporalAntialiasing/)
})

test("a scene's level sits below the preset and the page, the first scene naming one deciding", () => {
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({}, () => runtime, unseen)
  switches.sceneTemporalAntialiasing('low')
  switches.sceneTemporalAntialiasing('high')
  assert.equal(switches.temporalAntialiasing, 'low', 'the first scene decides')
  switches.quality.preset = 'fine'
  assert.equal(switches.temporalAntialiasing, 'high', "the preset's level over the scene's")
  switches.quality.preset = 'max'
  assert.equal(switches.temporalAntialiasing, 'low', 'max writes nothing: the scene shows again')
  const page = worldSwitches({ temporalAntialiasing: true }, () => runtime, unseen)
  page.sceneTemporalAntialiasing('off')
  assert.equal(page.temporalAntialiasing, 'max', "the page's true holds over the scene's off")
})

test('temporal antialiasing is at its finest level by default, the level resolved read back', () => {
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({}, () => runtime, unseen)
  assert.equal(switches.held.temporalAntialiasing, 'max', 'the finest level by default')
  assert.equal(switches.temporalAntialiasing, 'max', 'before a session: what the page asked')
  runtime.explorer = session().explorer
  assert.equal(switches.temporalAntialiasing, 'max', 'a session open: the level resolved still')
  // Undefined gives the setting back to the preset and the scene.
  switches.temporalAntialiasing = 'low'
  switches.temporalAntialiasing = undefined
  assert.equal(switches.temporalAntialiasing, 'max')
})

// #349: `world.effects` is one chain for the world's life, handed to every session it opens; a
// change of it asks for a frame, and reopens nothing.
test('the effect chain is given to every session, and a change of it asks for a frame', () => {
  let renewed = 0,
    invalidated = 0
  const runtime = {
    explorer: null as MeasuredWorld | null,
    renew: () => void renewed++,
    invalidate: () => void invalidated++,
  }
  const switches = worldSwitches({}, () => runtime, unseen)
  const chain = switches.held.effects
  assert.equal(sessionOptions({}, switches.held).effects, chain)
  assert.deepEqual(
    [chain.size, chain.passes.map(({ kind }) => kind), invalidated],
    [2, ['motionBlur', 'bloom'], 0],
    'a start',
  )
  chain.add(effect.bloom())
  ;(chain.passes[1] as ReturnType<typeof effect.bloom>).sizeScale = 2
  assert.equal(sessionOptions({}, switches.held).effects, chain, 'the same chain on reopen')
  assert.deepEqual([invalidated, renewed], [2, 0])
})

// S32: the page's switches are settings of the world's registry, at the page's priority; each is
// written into the open session once its resolved value changes, and no preset overwrites it.
test('the screen error and the bounce are the page’s settings, applied once each', () => {
  const errors: number[] = []
  const explorer = {
    setPixelError: (value: number) => void errors.push(value),
    setBounce() {},
  } as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({}, () => runtime, unseen)
  assert.equal(
    sessionOptions({}, switches.held).pixelError,
    DEFAULT_PIXEL_ERROR,
    'the balanced cut by default',
  )
  runtime.explorer = explorer
  switches.pixelError = 2
  switches.pixelError = 2
  assert.deepEqual(errors, [2], 'written once, into the open session')
  assert.equal(sessionOptions({}, switches.held).pixelError, 2, 'kept on reopen')
  switches.bounce = true
  switches.settings.set('bounce', false, 'quality')
  assert.equal(switches.bounce, true, 'a preset does not overwrite the page')
})

// The motion blur's drawing is a family by rule of the world's registry (`MOTION_BLUR_RULES`): the
// page's settings are written into the session once opened and, after, in place, once each.
test('how the motion blur is drawn is the page’s setting, applied once each', () => {
  const written: unknown[][] = []
  // An open session that takes every switch and records the motion blur's.
  const setters = { setMotionBlur: (...write: unknown[]) => void written.push(write) }
  const explorer = new Proxy(setters, {
    get: (held, name) => held[name as keyof typeof held] ?? (() => {}),
  }) as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({ motionBlurQuality: 'medium' }, () => runtime, unseen)
  assert.deepEqual(
    [switches.motionBlur.motionBlurQuality, switches.motionBlur.motionBlurHalfResInput],
    ['medium', true],
    'the page’s quality, the reference’s default for the rest',
  )
  switches.apply(explorer, sessionOptions({}, {}))
  assert.deepEqual(
    written.filter(([field]) => field === 'motionBlurQuality'),
    [['motionBlurQuality', 'medium']],
    'written into the session once it is open',
  )
  written.length = 0
  runtime.explorer = explorer
  switches.motionBlur = { motionBlurQuality: 'off' }
  switches.motionBlur = { motionBlurQuality: 'off' }
  assert.deepEqual(written, [['motionBlurQuality', 'off']], 'once, in place')
  switches.motionBlur = { motionBlurQuality: null }
  assert.equal(switches.motionBlur.motionBlurQuality, 'veryHigh', 'given back: the preset’s')
  // The level reads like the anti-aliasing's: `true` its default, `false` off.
  switches.motionBlur = { motionBlurQuality: false }
  assert.equal(switches.motionBlur.motionBlurQuality, 'off')
  switches.motionBlur = { motionBlurQuality: true }
  assert.equal(switches.motionBlur.motionBlurQuality, 'veryHigh')
  assert.throws(() => (switches.motionBlur = { motionBlurQuality: 'ultra' as never }), /ultra/)
  // The directions are one or two, one by default.
  assert.equal(switches.motionBlur.motionBlurDirections, 1)
  switches.motionBlur = { motionBlurDirections: 2 }
  assert.equal(switches.motionBlur.motionBlurDirections, 2)
  assert.throws(() => (switches.motionBlur = { motionBlurDirections: 3 }), /motionBlurDirections/)
})

// The film effects' settings are a family by rule (`FILM_RULES`), in the image effects' quality group:
// the page's are written into the session once opened and, after, in place; a preset writes two.
test('the film effects are the page’s setting, applied once each, over the preset’s', () => {
  const written: unknown[][] = []
  const setters = { setFilm: (...write: unknown[]) => void written.push(write) }
  const explorer = new Proxy(setters, {
    get: (held, name) => held[name as keyof typeof held] ?? (() => {}),
  }) as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({ filmGrainIntensity: 0.3 }, () => runtime, unseen)
  assert.deepEqual(
    [switches.film.filmGrainIntensity, switches.film.filmGrainShadowsMax],
    [0.3, 0.09],
    'the page’s grain, the reference’s default for the rest',
  )
  switches.apply(explorer, sessionOptions({}, {}))
  assert.deepEqual(
    written.filter(([field]) => field === 'filmGrainIntensity'),
    [['filmGrainIntensity', 0.3]],
    'written into the session once it is open',
  )
  written.length = 0
  runtime.explorer = explorer
  switches.film = { chromaticAberration: 2 }
  switches.film = { chromaticAberration: 2 }
  assert.deepEqual(written, [['chromaticAberration', 2]], 'once, in place')
  switches.film = { chromaticAberration: null }
  assert.equal(switches.film.chromaticAberration, 0, 'given back: the default, off')
  // A preset writes the tonemapper's quality and the fringe's; the page's setting holds over it.
  switches.quality.preset = 'smooth'
  assert.deepEqual(
    [switches.film.tonemapperQuality, switches.film.chromaticAberrationQuality],
    [0, 'off'],
  )
  switches.film = { tonemapperQuality: 5, chromaticAberrationQuality: true }
  assert.deepEqual(
    [switches.film.tonemapperQuality, switches.film.chromaticAberrationQuality],
    [5, 'high'],
  )
  assert.throws(() => (switches.film = { tonemapperQuality: 6 }), /tonemapperQuality/)
})

// The screen-space ambient occlusion's settings are a family by rule (`AMBIENT_OCCLUSION_RULES`), in the
// image effects' quality group: the page's are written into the session once opened and, after, in place.
test('how the ambient occlusion is set is the page’s setting, applied once each', () => {
  const written: unknown[][] = []
  const setters = { setAmbientOcclusion: (...write: unknown[]) => void written.push(write) }
  const explorer = new Proxy(setters, {
    get: (held, name) => held[name as keyof typeof held] ?? (() => {}),
  }) as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({ ambientOcclusionIntensity: 0.8 }, () => runtime, unseen)
  assert.deepEqual(
    [
      switches.ambientOcclusion.ambientOcclusionIntensity,
      switches.ambientOcclusion.ambientOcclusionRadius,
    ],
    [0.8, 2],
    'the page’s intensity, the reference’s default (200 cm) for the radius, in metres',
  )
  switches.apply(explorer, sessionOptions({}, {}))
  assert.deepEqual(
    written.filter(([field]) => field === 'ambientOcclusionIntensity'),
    [['ambientOcclusionIntensity', 0.8]],
    'written into the session once it is open',
  )
  written.length = 0
  runtime.explorer = explorer
  switches.ambientOcclusion = { ambientOcclusionPower: 3 }
  switches.ambientOcclusion = { ambientOcclusionPower: 3 }
  assert.deepEqual(written, [['ambientOcclusionPower', 3]], 'once, in place')
  switches.ambientOcclusion = { ambientOcclusionPower: null }
  assert.equal(switches.ambientOcclusion.ambientOcclusionPower, 2, 'given back: the default')
  assert.throws(() => (switches.ambientOcclusion = { ambientOcclusionIntensity: 2 }), /Intensity/)
  assert.throws(() => (switches.ambientOcclusion = { ambientOcclusionLevels: 4 }), /Levels/)
})

// The volumetric fog's settings are a family by rule too (`VOLUMETRIC_FOG_RULES`), in the shadows'
// quality group: the page's are written into the session once opened and, after, in place, once each.
test('how the volumetric fog is drawn is the page’s setting, applied once each', () => {
  const written: unknown[][] = []
  const setters = { setVolumetricFog: (...write: unknown[]) => void written.push(write) }
  const explorer = new Proxy(setters, {
    get: (held, name) => held[name as keyof typeof held] ?? (() => {}),
  }) as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({ volumetricFogQuality: 'low' }, () => runtime, unseen)
  assert.deepEqual(
    [switches.volumetricFog.volumetricFogQuality, switches.volumetricFog.volumetricFogHistoryShare],
    ['low', 0.9],
    'the page’s quality, the default for the rest',
  )
  switches.apply(explorer, sessionOptions({}, {}))
  assert.deepEqual(
    written.filter(([field]) => field === 'volumetricFogQuality'),
    [['volumetricFogQuality', 'low']],
    'written into the session once it is open',
  )
  written.length = 0
  runtime.explorer = explorer
  switches.volumetricFog = { volumetricFogQuality: 'ultra', volumetricFogHistoryShare: 0.8 }
  switches.volumetricFog = { volumetricFogQuality: 'ultra' }
  assert.deepEqual(
    written,
    [
      ['volumetricFogQuality', 'ultra'],
      ['volumetricFogHistoryShare', 0.8],
    ],
    'once each, in place',
  )
  switches.volumetricFog = { volumetricFogQuality: null }
  assert.equal(switches.volumetricFog.volumetricFogQuality, 'high', 'given back: the preset’s')
  assert.throws(
    () => (switches.volumetricFog = { volumetricFogQuality: 'cinematic' as never }),
    /cinematic/,
  )
})

// The sky's quality is a family by rule too (`SKY_QUALITY_RULES`), in the effects' group, which the
// quality presets write the atmosphere's levels in: the page's are written into the session once
// opened and, after, in place, once each.
test('how the sky is drawn is the page’s setting, applied once each', () => {
  const written: unknown[][] = []
  const setters = { setSkyQuality: (...write: unknown[]) => void written.push(write) }
  const explorer = new Proxy(setters, {
    get: (held, name) => held[name as keyof typeof held] ?? (() => {}),
  }) as unknown as MeasuredWorld
  const runtime = { explorer: null as MeasuredWorld | null, renew() {}, invalidate() {} }
  const switches = worldSwitches({ atmosphereSamplesMax: 32 }, () => runtime, unseen)
  assert.deepEqual(
    [switches.skyQuality.atmosphereSamplesMax, switches.skyQuality.aerialDepthSlices],
    [32, 16],
    'the page’s cap, the default for the rest',
  )
  switches.apply(explorer, sessionOptions({}, {}))
  assert.deepEqual(
    written.filter(([field]) => field === 'atmosphereSamplesMax'),
    [['atmosphereSamplesMax', 32]],
    'written into the session once it is open',
  )
  written.length = 0
  runtime.explorer = explorer
  switches.skyQuality = { atmosphereSamplesMax: 64, skyTableFast: false }
  switches.skyQuality = { atmosphereSamplesMax: 64 }
  assert.deepEqual(
    written,
    [
      ['skyTableFast', false],
      ['atmosphereSamplesMax', 64],
    ],
    'once each, in place',
  )
  switches.skyQuality = { atmosphereSamplesMax: null }
  assert.equal(switches.skyQuality.atmosphereSamplesMax, 128, 'given back: the default')
  assert.throws(() => (switches.skyQuality = { aerialDepthSlices: 2 }), /aerialDepthSlices/)
})

test('the resolution asked at creation is the render scale, unless the page gives one', () => {
  const runtime = { explorer: null, renew() {}, invalidate() {} }
  const made = (options: Parameters<typeof worldSwitches>[0]) =>
    worldSwitches(options, () => runtime, unseen).held
  assert.equal(made({}).renderScale, 'auto')
  assert.equal(made({ quality: { resolution: { mode: 'fast' } } }).renderScale, 0.5)
  assert.equal(made({ renderScale: 1, quality: { resolution: { mode: 'fast' } } }).renderScale, 1)
})
