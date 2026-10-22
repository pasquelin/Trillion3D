import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredView } from './view.ts'
import { VIEW_LAYOUT } from './worldAtWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { readFileSync } from 'node:fs'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { createGpuHiz } from '../../visibility/hiz/gpu/factory.ts'
import { createScreenReflection } from '../reflections/gpu.ts'
import { encodeScreenProbes } from '../bounce/screen/frame.ts'
import { AMBIENT_OCCLUSION_PASS, SCREEN_PROBE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { dispatchedEntries } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { createDeferredLighting } from './deferred.ts'
import { gpuHarness } from './contractLighting.fixture.ts'
import { installGpuDeviceLedger } from '../../gpu/core/deviceLedger.ts'
import { blueNoiseTextures } from '../../gpu/noise/blueNoiseTextures.ts'
import { encodeAmbientOcclusion } from '../ao/frame.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'

// A frame drawn below the display without the temporal resolve was composed pixel for pixel: the
// composition reads where each display pixel falls in the image drawn (`composeSource`).
test('the source words are its ratio to the display and its last pixel, written when they change', () => {
  const gpu = fakeDevice()
  const view = createDeferredView(gpu.device)
  const written = () => gpu.writes.filter((write) => write.offset === VIEW_LAYOUT.at.source * 4)
  view.writeSource([1, 1], [1, 1])
  assert.equal(written().length, 0, 'at the display size, as made: nothing to write')
  view.writeSource([496, 448], [990, 888])
  assert.deepEqual(
    [...new Float32Array(written()[0].data as ArrayLike<number>)],
    [Math.fround(496 / 990), Math.fround(448 / 888), 495, 447],
  )
  view.writeSource([496, 448], [990, 888])
  assert.equal(written().length, 1, 'the same source writes nothing')
})

/** A runtime reduced to what the screen probes read of a frame, over the kit's device: real lighting, depth
 *  pyramid and reflection, a G-buffer of stand-in views. */
async function probesRuntime(options: Record<string, unknown> = {}) {
  const h = gpuHarness()
  const reflection = createScreenReflection(h.device, 64, 64, false)
  reflection.frame.depthDrawn = true
  const views = [h.view(), h.view(), h.view(), h.view()]
  const rt = {
    gpu: {
      device: h.device,
      reflection,
      deferred: await createDeferredLighting(h.device),
      surfaces: { views: () => views },
      targetSize: [64, 64],
      allocatedSize: [64, 64],
      screenProbes: undefined,
    },
    vis: { gpuHiz: await createGpuHiz(h.device, 64, 64), reflectionPipelines: {} },
    lights: { buffer: {} as GPUBuffer, store: { unlit: false } },
    run: { depthDrawn: true, diagnostic: 'beauty' },
    bounce: { wanted: true, probes: undefined },
    context: options,
  } as unknown as WebgpuPagesRuntime
  // The kernels compile off the frame: the first image casts none, a later one does.
  const encode = async () => {
    for (let waited = 0; waited < 100; waited++) {
      const before = h.dispatches.length
      encodeScreenProbes(rt, h.encoder)
      if (h.dispatches.length > before) return h
      await new Promise((done) => setImmediate(done))
    }
    throw new Error(rt.bounce.screen?.reason ?? 'the screen probes never cast')
  }
  return { h, rt, encode }
}

test('one image of screen probes encodes its passes in order, hands the lighting its result and counts what it cast', async () => {
  const { h, rt, encode } = await probesRuntime()
  await encode()
  assert.deepEqual(dispatchedEntries(h.dispatches), [
    'placeUniform',
    'adaptiveMark',
    'adaptiveSpawn',
    'probeArgs',
    'screenData',
    'genRays',
    'traceScreen',
    'traceField',
    'traceScene',
    'composite',
    'spatialFilter',
    'spatialFilter',
    'spatialFilter',
    'convert',
    'occlusion',
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

test('the screen probes leave out the passes their settings leave out, and cast none at the level off', async () => {
  const lean = await probesRuntime({
    screenProbeSceneTraces: false,
    screenProbeImportanceSampling: false,
    screenProbeShortRangeOcclusion: false,
    screenProbeSpatialFilterPasses: 1,
  })
  await lean.encode()
  assert.deepEqual(dispatchedEntries(lean.h.dispatches).slice(3), [
    'probeArgs',
    'screenData',
    'traceScreen',
    'traceField',
    'composite',
    'spatialFilter',
    'convert',
    'temporal',
  ])
  const off = await probesRuntime({ screenProbes: 'off' })
  encodeScreenProbes(off.rt, off.h.encoder)
  assert.deepEqual(off.h.dispatches, [])
  assert.equal(off.rt.bounce.screen!.metrics, undefined)
  // The level off gives the view's probes back: the budget holds none, the lighting is left none to read.
  const held = await probesRuntime()
  await held.encode()
  assert.ok(held.rt.gpu.screenProbes!.bytes > 0, 'the probes of the view are held')
  held.rt.context.screenProbes = false
  encodeScreenProbes(held.rt, held.h.encoder)
  assert.equal(held.rt.gpu.screenProbes, undefined, 'off gives them back')
})

/** The words the lighting was last told of how to read the screen probes (`writeScreenProbes`). */
const screenProbeWords = (h: { writes: { offset: number; data: unknown }[] }) => {
  const last = h.writes.filter((w) => w.offset === VIEW_LAYOUT.at.screenProbes * 4).at(-1)
  return last ? [...new Float32Array(last.data as ArrayLike<number>)] : []
}

test('the level low runs the occlusion and the temporal pass alone over one probe, and tells the lighting to read their occlusion over the world’s light; a level that casts tells it the probes’ light', async () => {
  const low = await probesRuntime({ screenProbes: 'low' })
  await low.encode()
  assert.deepEqual(dispatchedEntries(low.h.dispatches), ['occlusion', 'temporal'])
  const metrics = low.rt.bounce.screen!.metrics!
  assert.deepEqual([metrics.level, metrics.raysPerImage, metrics.atlas], ['low', 0, [0, 0]])
  assert.deepEqual(
    screenProbeWords(low.h),
    [1, 0.5, 1, 1],
    'the material’s occlusion, the albedo cap, the strength, mode 1',
  )
  const ultra = await probesRuntime()
  await ultra.encode()
  assert.deepEqual(screenProbeWords(ultra.h), [1, 0.5, 1, 0], 'mode 0: the probes’ light')
  const bare = await probesRuntime({
    screenProbes: 'low',
    screenProbeShortRangeOcclusion: false,
  })
  encodeScreenProbes(bare.rt, bare.h.encoder)
  assert.deepEqual(bare.h.dispatches, [], 'a level with no probe and no occlusion runs nothing')
  assert.equal(bare.rt.gpu.screenProbes, undefined)
})

test('a render scale moves the size an image is drawn at, and the probes made for the targets stay: nothing is remade, the history alone is dropped', async () => {
  const { h, rt, encode } = await probesRuntime()
  await encode()
  const made = rt.gpu.screenProbes!
  const textures = h.textures.length
  rt.gpu.targetSize = [48, 32]
  encodeScreenProbes(rt, h.encoder)
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
    encodeScreenProbes(rt, h.encoder)
    if (rt.bounce.screen!.metrics?.unavailable?.includes('budget')) break
    await new Promise((done) => setImmediate(done))
  }
  assert.equal(rt.gpu.screenProbes, undefined, 'none held')
  assert.match(rt.bounce.screen!.metrics!.unavailable ?? '', /budget/)
  assert.equal(h.dispatches.length, 0, 'no pass encoded')
})

test('the frame runs the screen probes after the reflections, the radiance cache the screen probes did not update after them, the occlusion after that, and the lighting binds their results after all', () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const preLight = read('../../frame/render/preLight.ts')
  const order = [
    'encodeReflections(rt, encoder)',
    'encodeScreenProbes(rt, encoder)',
    'flushRadianceCache(rt, encoder)',
    'encodeAmbientOcclusion(rt, encoder, cam)',
  ]
  const at = order.map((call) => preLight.indexOf(call))
  assert.ok(
    at.every((index) => index >= 0),
    `each is called: ${at}`,
  )
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
    'in this order',
  )
  const surfaces = read('../../frame/render/surfaceLighting.ts')
  assert.ok(
    surfaces.indexOf('encodePreLight(rt, device, encoder, cam, direct)') <
      surfaces.indexOf('lightSurfaces(rt, encoder, clear, raw, direct)'),
    'the lighting binds after the passes it reads',
  )
})

/** The frames of a view whose pixels no screen probes light (the level `off`), drawn until the occlusion's programs have compiled. */
async function occlusionRuntime(options: Record<string, unknown> = { screenProbes: 'off' }) {
  const made = await probesRuntime(options)
  const projection = new Float64Array(16),
    world = new Float64Array(16)
  projection[0] = projection[5] = 1.7
  world[0] = world[5] = world[10] = world[15] = 1
  const camera = { projection, world, near: 0.1, far: 1000 } as unknown as EngineCamera
  Object.assign(camera, { perspective: 1 })
  const encode = async () => {
    for (let waited = 0; waited < 100; waited++) {
      const before = made.h.draws.length
      encodeAmbientOcclusion(made.rt, made.h.encoder, camera)
      if (made.h.draws.length > before) return made.h
      await new Promise((done) => setImmediate(done))
    }
    throw new Error('the occlusion never drew')
  }
  /** The mode and the share the lighting was last told: the two words of the view uniform's `views`. */
  const applied = () => {
    const last = made.h.writes.filter((w) => w.offset === (VIEW_LAYOUT.at.views + 1) * 4).at(-1)
    return last ? [...new Float32Array(last.data as ArrayLike<number>)] : []
  }
  const labels = () => made.h.draws.map((d) => String(d.pipeline.label).split(' ').at(-1))
  return { ...made, camera, encode, applied, labels }
}

test('where no screen probes light the image, the occlusion draws its passes in order and tells the lighting how to apply it', async () => {
  const { h, rt, encode, applied, labels } = await occlusionRuntime()
  await encode()
  // The default quality: two resolutions, the shader quality 2 — the setup, the search at the half, the last pass.
  assert.deepEqual(labels(), ['setup', '2sn', '2fu'])
  assert.deepEqual(
    h.passDescriptors.slice(-3).map((pass) => pass.label),
    Array(3).fill(AMBIENT_OCCLUSION_PASS),
  )
  assert.deepEqual(
    h.passes.slice(-3).map((pass) => pass.formats[0]),
    ['rgba16float', 'r8unorm', 'r8unorm'],
  )
  assert.ok(
    rt.gpu.ambientOcclusion!.output && rt.gpu.ambientOcclusion!.bytes > 0,
    'handed over, counted',
  )
  assert.deepEqual(applied(), [1, 1], 'the scene mode, at the static fraction of 1')
  // Each pass's uniform: the radius the half takes grown by the scale once, the scale to the full size, in its words.
  const uniforms = h.writes
    .filter((write) =>
      String((write.buffer as { label?: string })?.label).includes('ambient occlusion pass'),
    )
    .map((write) => [...new Float32Array(new Uint32Array(write.data as ArrayLike<number>).buffer)])
  assert.deepEqual(
    uniforms.map((w) => [+w[4].toFixed(4), w[6]]),
    [
      [0.2125, 2],
      [0.2125, 2],
      [0.125, 1],
    ],
  )
})

test('with the screen probes on, the occlusion draws nothing and holds nothing; asked, and their own off, it draws over their light', async () => {
  const probes = await occlusionRuntime({}),
    textures = probes.h.textures.length
  encodeAmbientOcclusion(probes.rt, probes.h.encoder, probes.camera)
  assert.deepEqual([probes.h.draws.length, probes.h.textures.length - textures], [0, 0])
  // Asked, with their occlusion still on: still none. Asked, and theirs off: over their light, at their strength.
  const both = await occlusionRuntime({ ambientOcclusionWithScreenProbes: true })
  encodeAmbientOcclusion(both.rt, both.h.encoder, both.camera)
  assert.equal(both.h.draws.length, 0)
  const over = await occlusionRuntime({
    ambientOcclusionWithScreenProbes: true,
    screenProbeShortRangeOcclusion: false,
    screenProbeOcclusionIntensity: 0.6,
  })
  await over.encode()
  assert.deepEqual(over.applied(), [2, Math.fround(0.6)])
})

test('the occlusion draws as many resolutions as its settings ask, and gives its textures back when it draws none', async () => {
  const one = await occlusionRuntime({ screenProbes: 'off', ambientOcclusionLevels: 1 })
  await one.encode()
  assert.deepEqual(one.labels(), ['setup', '2fn'], 'the half-size depth map, the last pass')
  const three = await occlusionRuntime({ screenProbes: 'off', ambientOcclusionQuality: 90 })
  await three.encode()
  // Setups of the half and the quarter, their searches, and the last pass: shader quality 4, the six-point set.
  assert.deepEqual(three.labels(), ['setup', 'setup', '4sn', '4su', '4fu'])
  const draws = three.h.draws.length
  three.rt.context.ambientOcclusionIntensity = 0
  encodeAmbientOcclusion(three.rt, three.h.encoder, three.camera)
  assert.equal(three.h.draws.length, draws, 'no pass')
  assert.equal(three.rt.gpu.ambientOcclusion!.bytes, 0, 'no byte')
  assert.deepEqual(three.applied(), [0, 0], 'the lighting applies none')
})
