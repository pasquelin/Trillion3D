// The screen probes in the frame: their passes in order, the level off, the render scale, the budget and the order in the frame.

import test from 'node:test'
import assert from 'node:assert/strict'
import { SCREEN_PROBE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { installGpuDeviceLedger } from '../../gpu/core/deviceLedger.ts'
import { blueNoiseTextures } from '../../gpu/noise/blueNoiseTextures.ts'
import { pipelinesCompiling, pipelinesSettled } from './compileLedger.ts'
import { encodeProbeImage, probesRuntime, screenProbeWords } from './screenProbesRuntime.fixture.ts'
import { closureTilesOf, encodeClosureTiles } from '../../visibility/closureTiles/closureTiles.ts'
import { placeScreenProbes, traceScreenProbes } from '../bounce/screen/frame.ts'

/** The words the lighting is told are 32-bit floats: the setting's default foliage strength, as one holds it. */
const FOLIAGE_STRENGTH = Math.fround(0.7)

test('one image of screen probes encodes its passes in order, hands the lighting its result and counts what it cast', async () => {
  const { h, rt, encode } = await probesRuntime()
  await encode()
  assert.deepEqual(dispatchedEntries(h.dispatches), [
    'placeUniform',
    'adaptiveMark',
    'adaptiveSpawn',
    'adaptiveNumber',
    'adaptiveWrite',
    'probeArgs',
    'screenData',
    'genRays',
    'traceScreen',
    'traceScene',
    'composite',
    'spatialFilter',
    'spatialFilter',
    'spatialFilter',
    'convert',
    'fixup',
    'occlusion',
    'tileInit',
    'tileClassify',
    'tileFinish',
    'integrateSimple',
    'integrateSampled',
    'integrateComplete',
    'temporal',
  ])
  assert.equal(
    h.passDescriptors.at(-1)?.label,
    SCREEN_PROBE_PASS,
    'one pass, timed as the engine names it',
  )
  const metrics = rt.bounce.screen!.metrics!
  assert.deepEqual(
    [metrics.level, metrics.tile, metrics.sceneTraces, metrics.meshTraces, metrics.velocity],
    ['ultra', 16, true, false, false],
  )
  assert.equal(metrics.unavailable, null)
})

test('a view whose pixels hold several closures runs the pixel passes again for each closure past the first over the overflow tiles of the closure, over its own history, and tells the lighting they were gathered', async () => {
  const { h, rt, encode } = await probesRuntime()
  const views = rt.gpu.surfaces!.views()
  rt.gpu.surfaces = {
    views: () => views,
    closures: 3,
    closureNormals: [h.view(), h.view()],
    width: 64,
    height: 64,
    words: h.device.createTexture({ size: [64, 64, 4], format: 'r32uint', usage: 4 }),
  } as unknown as typeof rt.gpu.surfaces
  // The closure tiles of the view are listed after the resolve, ahead of the probes (`encodeClosureTiles`): the record holds several closures.
  Object.assign((rt.vis.closures ??= {} as NonNullable<typeof rt.vis.closures>), {
    census: -1,
    shapes: 0,
    summed: { frame: -1, revision: -1, shapes: 0 },
    applied: undefined,
    limit: 4,
    countFromMaterial: true,
    most: 3,
    max: 3,
  })
  for (let waited = 0; waited < 100 && !closureTilesOf(rt); waited++) {
    encodeClosureTiles(rt, h.encoder)
    await new Promise((done) => setImmediate(done))
  }
  assert.ok(closureTilesOf(rt), 'the overflow tiles are listed')
  await encode()
  const entries = dispatchedEntries(h.dispatches)
  const pixels = [
    'occlusion',
    'tileInit',
    'tileClassify',
    'tileFinish',
    'integrateSimple',
    'integrateSampled',
    'integrateComplete',
    'temporal',
  ]
  const from = entries.indexOf('occlusion')
  // The first closure's pixel passes over the view, then the same kernels for the second and the third over the overflow tiles, each its own.
  assert.deepEqual(entries.slice(from), [...pixels, ...pixels, ...pixels])
  const view = rt.gpu.screenProbes!
  assert.equal(view.closures, 3)
  assert.ok(view.indirectClosures, 'the lighting reads the history of every closure')
  assert.notEqual(view.indirectClosures, view.indirect)
  assert.equal(screenProbeWords(h)[3]! & 8, 8, 'and is told the probes gathered them (bit 3)')
})

test('the placement is a pass of its own that asks the probes of their pixels and hands the pool the probes it placed, and the trace follows in another', async () => {
  const { h, rt, encode } = await probesRuntime()
  await encode()
  const before = h.dispatches.length
  const passes = h.passDescriptors.length
  const placed = placeScreenProbes(rt, h.encoder)
  assert.deepEqual(dispatchedEntries(h.dispatches.slice(before)), [
    'placeUniform',
    'adaptiveMark',
    'adaptiveSpawn',
    'adaptiveNumber',
    'adaptiveWrite',
    'probeArgs',
    'screenData',
  ])
  assert.equal(h.passDescriptors.length, passes + 1, 'the placement alone, a pass of its own')
  const view = rt.gpu.screenProbes!
  assert.equal(
    placed?.marks?.info,
    view.resources.info[view.turn],
    'the records of the turn it placed',
  )
  traceScreenProbes(rt, h.encoder, placed)
  assert.equal(h.passDescriptors.length, passes + 2, 'the trace in another')
  const traced = dispatchedEntries(h.dispatches.slice(before))
  assert.equal(traced.at(-1), 'temporal')
  assert.equal(
    traced.filter((entry) => entry === 'screenData').length,
    1,
    'asked once, in the placement',
  )
})

test('the screen probes leave out the passes their settings leave out, and cast none at the level off', async () => {
  const lean = await probesRuntime({
    screenProbeSceneTraces: false,
    screenProbeImportanceSampling: false,
    screenProbeShortRangeOcclusion: false,
    screenProbeSpatialFilterPasses: 1,
  })
  await lean.encode()
  assert.deepEqual(dispatchedEntries(lean.h.dispatches).slice(5), [
    'probeArgs',
    'screenData',
    'traceScreen',
    'traceScene',
    'composite',
    'spatialFilter',
    'convert',
    'fixup',
    'tileInit',
    'tileClassify',
    'tileFinish',
    'integrateSimple',
    'integrateSampled',
    'integrateComplete',
    'temporal',
  ])
  const off = await probesRuntime({ screenProbes: 'off' })
  encodeProbeImage(off.rt, off.h.encoder)
  assert.deepEqual(off.h.dispatches, [])
  assert.equal(off.rt.bounce.screen!.metrics, undefined)
  // The bounce wanted with the probes off is the reference's `r.ScreenProbeGather 0` (`ScreenProbeGather.cpp:2194-2201`): black diffuse and rough specular, the Lumen
  // diffuse global illumination having taken the sky light's place. The mode is the probes' light, none of it left.
  assert.deepEqual(
    screenProbeWords(off.h),
    [FOLIAGE_STRENGTH, 0.5, 1, 0],
    'the level off under a bounce leaves the lighting no light: black, as the reference does',
  )
  // With no bounce asked there is no global illumination to take the sky light's place: the lighting keeps the sky light's irradiance (mode bit 0), as with no global illumination in the reference.
  const unlit = await probesRuntime({ screenProbes: 'off' })
  unlit.rt.bounce.wanted = false
  encodeProbeImage(unlit.rt, unlit.h.encoder)
  assert.deepEqual(
    screenProbeWords(unlit.h),
    [FOLIAGE_STRENGTH, 0.5, 1, 1],
    'no bounce: the sky light under their occlusion alone, never the black of a pixel the probes gather and did not read',
  )
  // The level off gives the view's probes back: the budget holds none, the lighting is left none to read.
  const held = await probesRuntime()
  await held.encode()
  assert.ok(held.rt.gpu.screenProbes!.bytes > 0, 'the probes of the view are held')
  Object.assign(held.rt.context, { screenProbes: false })
  encodeProbeImage(held.rt, held.h.encoder)
  assert.equal(held.rt.gpu.screenProbes, undefined, 'off gives them back')
})

test('a level that casts tells the lighting the probes’ light, and the level off under a bounce tells it they left none: black, as the reference’s screen probe gather off', async () => {
  const ultra = await probesRuntime()
  await ultra.encode()
  assert.deepEqual(
    screenProbeWords(ultra.h),
    [FOLIAGE_STRENGTH, 0.5, 1, 0],
    'mode 0: the probes’ light',
  )
  // The integration that applies the short-range occlusion says so in bit 2: the lighting then applies none.
  const applied = await probesRuntime({ screenProbeShortRangeAOApplyDuringIntegration: true })
  await applied.encode()
  assert.deepEqual(
    screenProbeWords(applied.h),
    [FOLIAGE_STRENGTH, 0.5, 1, 4],
    'mode 0 and bit 2: the probes’ light, the occlusion already in it',
  )
  const off = await probesRuntime({ screenProbes: 'off' })
  encodeProbeImage(off.rt, off.h.encoder)
  assert.deepEqual(off.h.dispatches, [], 'a level with no probe runs nothing')
  assert.equal(off.rt.gpu.screenProbes, undefined)
  assert.deepEqual(
    screenProbeWords(off.h),
    [FOLIAGE_STRENGTH, 0.5, 1, 0],
    'mode 0 with no probe to read: their light is none, so the pixels are black',
  )
})

test('a render scale moves the size an image is drawn at, and the probes made for the targets stay: nothing is remade, the history alone is dropped', async () => {
  const { h, rt, encode } = await probesRuntime()
  await encode()
  const made = rt.gpu.screenProbes!
  const textures = h.textures.length
  rt.gpu.targetSize = [48, 32]
  encodeProbeImage(rt, h.encoder)
  assert.equal(rt.gpu.screenProbes, made, 'the same probes, at the size the targets are made at')
  assert.equal(h.textures.length, textures, 'no texture made again')
  const metrics = rt.bounce.screen!.metrics!
  assert.deepEqual(
    [metrics.history, metrics.atlas],
    [false, [3, 3]],
    'a smaller image, its own probes in the same atlas',
  )
  assert.equal(made.image?.width, 48)
})

test('a budget with no room for the probes leaves the lighting none to read, says why, and holds none', async () => {
  const { h, rt } = await probesRuntime()
  // The engine's blue noise is made before the budget shrinks: the probes' own memory is what has no room.
  await blueNoiseTextures(h.device)
  installGpuDeviceLedger(h.device, { limit: () => 1024 })
  // The kernels compile off the frame; once they have, the first image that would make the probes finds no room for them.
  for (let waited = 0; waited < 100; waited++) {
    encodeProbeImage(rt, h.encoder)
    if (rt.bounce.screen!.metrics?.unavailable?.includes('budget')) break
    await new Promise((done) => setImmediate(done))
  }
  assert.equal(rt.gpu.screenProbes, undefined, 'none held')
  assert.match(rt.bounce.screen!.metrics!.unavailable ?? '', /budget/)
  assert.equal(h.dispatches.length, 0, 'no pass encoded')
})

test('the probes cast nothing and give the view back where the image is not lit: its lights all removed, or a view of raw values', async () => {
  for (const [label, unlit] of [
    ['lights removed', true],
    ['a raw view', false],
  ] as const) {
    const made = await probesRuntime()
    await made.encode()
    assert.ok(made.rt.gpu.screenProbes!.bytes > 0, `${label}: held while the image is lit`)
    if (unlit) Object.assign(made.rt.lights.store, { unlit: true })
    else made.rt.run.diagnostic = 'wireframe'
    const before = made.h.dispatches.length
    encodeProbeImage(made.rt, made.h.encoder)
    assert.equal(made.h.dispatches.length, before, `${label}: no pass`)
    assert.equal(made.rt.gpu.screenProbes, undefined, `${label}: given back`)
  }
})

test('the kernels compile while the frames go on: the first frame waits for them, a switch of the level never makes one wait', async () => {
  const made = await probesRuntime()
  await blueNoiseTextures(made.h.device)
  encodeProbeImage(made.rt, made.h.encoder)
  assert.ok(
    pipelinesSettled(made.h.device),
    'the compile is in flight: the first frame waits for it',
  )
  assert.equal(pipelinesCompiling(made.h.device), false, 'no later frame is held for it')
})
