import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeferredView } from './view.ts'
import { VIEW_LAYOUT } from './worldAtWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { AMBIENT_OCCLUSION_PASS } from '../../diagnostic/stage/passLabels.ts'
import { encodeAmbientOcclusion } from '../ao/frame.ts'
import { occlusionRuntime } from '../ao/occlusion.fixture.ts'
import { createDeferredLighting } from './deferred.ts'
import { gpuHarness } from './contractLighting.fixture.ts'
import { FULL_CONTRACT } from './contractCuts.ts'
import { SURFACE_COLOUR_PASS, TILE_CLASSIFICATION_PASS } from '../../diagnostic/stage/passLabels.ts'

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

test('where no global illumination is on, the occlusion draws its passes in order and tells the lighting how to apply it', async () => {
  const { h, rt, encode, applied, labels } = await occlusionRuntime()
  await encode()
  // The default quality: two resolutions, the shader quality 2 — the setup, the search at the half, the last pass.
  assert.deepEqual(labels(), ['setup', '2sn', '2fu'])
  assert.deepEqual(
    h.passDescriptors.slice(-3).map((pass) => pass?.label),
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

test('with the bounce on, at any level of the screen probes, the occlusion draws nothing and holds nothing; asked, and their own off, it draws over their light', async () => {
  // The bounce on is the global illumination on: the probes' own short-range occlusion is the one there, at the level `off` of the
  // screen probes too, and at the lowest that lights, which reads the world's probes.
  for (const screenProbes of ['high', 'off', 'low']) {
    const probes = await occlusionRuntime({ screenProbes }, true),
      textures = probes.h.textures.length
    encodeAmbientOcclusion(probes.rt, probes.h.encoder, probes.camera)
    assert.deepEqual(
      [probes.h.draws.length, probes.h.textures.length - textures],
      [0, 0],
      screenProbes,
    )
  }
  // Asked, with their occlusion still on: still none. Asked, and theirs off: over their light, at their strength.
  const both = await occlusionRuntime({ ambientOcclusionWithScreenProbes: true }, true)
  encodeAmbientOcclusion(both.rt, both.h.encoder, both.camera)
  assert.equal(both.h.draws.length, 0)
  const over = await occlusionRuntime(
    {
      ambientOcclusionWithScreenProbes: true,
      screenProbeShortRangeOcclusion: false,
      screenProbeOcclusionIntensity: 0.6,
    },
    true,
  )
  await over.encode()
  assert.deepEqual(over.applied(), [2, Math.fround(0.6)])
  // With the bounce off the occlusion draws for the scene, whatever level the screen probes are set at.
  const scene = await occlusionRuntime({ screenProbes: 'high' })
  await scene.encode()
  assert.deepEqual(scene.applied(), [1, 1])
})

test('the occlusion draws as many resolutions as its settings ask, and gives its textures back when it draws none', async () => {
  const one = await occlusionRuntime({ ambientOcclusionLevels: 1 })
  await one.encode()
  assert.deepEqual(one.labels(), ['2fn'], 'the last pass alone: the taps read the depth pyramid')
  const three = await occlusionRuntime({ ambientOcclusionQuality: 90 })
  await three.encode()
  // Setups of the half and the quarter, their searches, and the last pass: shader quality 4, the six-point set.
  assert.deepEqual(three.labels(), ['setup', 'setup', '4sn', '4su', '4fu'])
  const draws = three.h.draws.length
  Object.assign(three.rt.context, { ambientOcclusionIntensity: 0 })
  encodeAmbientOcclusion(three.rt, three.h.encoder, three.camera)
  assert.equal(three.h.draws.length, draws, 'no pass')
  assert.equal(three.rt.gpu.ambientOcclusion!.bytes, 0, 'no byte')
  assert.deepEqual(three.applied(), [0, 0], 'the lighting applies none')
})

test('the compute pass draws one resolution and smooths it, unless the image accumulates in time', async () => {
  const run = await occlusionRuntime({ ambientOcclusionCompute: 1 })
  await run.encode()
  assert.deepEqual(
    run.labels(),
    ['2fnd', 'smooth'],
    'the depth’s normals; the smoothing a pass of its own',
  )
  const accumulating = await occlusionRuntime({ ambientOcclusionCompute: 1 })
  accumulating.rt.gpu.temporal = { frame: { active: true, stochasticSample: 0 } } as never
  await accumulating.encode()
  assert.deepEqual(accumulating.labels(), ['2fnd'], 'the temporal pass smooths it already')
})

test('the occlusion keeps its bind groups for the resources a view meets, two inputs taking turns included', async () => {
  const run = await occlusionRuntime()
  await run.encode()
  const made = () =>
    run.h.bindGroups.filter((group) => String(group.label).includes('ambient occlusion')).length
  const first = made()
  assert.equal(first, 3, 'a group a pass')
  await run.encode()
  await run.encode()
  assert.equal(made(), first, 'the same resources: no group made again')
  // The normals taking turns between two textures: a second set for the second, none more however many images follow.
  const views = run.rt.gpu.surfaces!.views()
  const turns = [views, [views[0], run.h.view(), views[2], views[3]]]
  for (let image = 0; image < 6; image++) {
    run.rt.gpu.surfaces!.views = () => turns[image % 2]
    encodeAmbientOcclusion(run.rt, run.h.encoder, run.camera)
  }
  assert.equal(made(), first + 3)
})

test('a lit frame draws its passes in order: classification, then one render pass of the colour, the indirect light, the sun and the local lights, each light draw once for each class of tile', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device, undefined, {
      precompile: true,
      bounce: false,
      key: { ...FULL_CONTRACT, lobeless: true },
    })
  const hdr = h.view(),
    depth = h.view()
  const frame = () => {
    lighting.bind(h.surface, depth, hdr, true, { lights: {} as GPUBuffer })
    return lighting.light(h.encoder, hdr)
  }
  frame()
  await lighting.settle()
  const first = h.passDescriptors.length
  const made = frame()
  assert.deepEqual(
    h.passDescriptors.slice(first).map((pass) => pass?.label),
    [TILE_CLASSIFICATION_PASS, SURFACE_COLOUR_PASS],
    'the lit image is one render pass',
  )
  assert.equal(made, 1 + 3 * 3, 'the colour draw, and the three light draws over three classes')
  assert.deepEqual(
    h.draws.slice(-9).map(({ pipeline }) => (pipeline as { label?: string }).label),
    ['INDIRECT', 'SUN', 'LOCAL'].flatMap((pass) =>
      ['SIMPLE', 'SINGLE', 'COMPLEX'].map((tileClass) => `DIRECT_${pass}_${tileClass}`),
    ),
  )
  // A scene with no sun draws no sun's draws, one with no local light no local lights' draws.
  const passes = (direct: { suns?: number; locals?: number }) => {
    const before = h.draws.length
    lighting.bind(h.surface, depth, hdr, true, { lights: {} as GPUBuffer, ...direct })
    lighting.light(h.encoder, hdr)
    return h.draws.slice(before).map(({ pipeline }) => (pipeline as { label?: string }).label)
  }
  const kinds = (direct: { suns?: number; locals?: number }) =>
    new Set(passes(direct).map((label) => label?.split('_')[1]))
  assert.ok(!kinds({ suns: 0, locals: 2 }).has('SUN'))
  assert.ok(kinds({ suns: 0, locals: 2 }).has('LOCAL'))
  assert.ok(!kinds({ suns: 1, locals: 0 }).has('LOCAL'))
  assert.ok(kinds({ suns: 1, locals: 0 }).has('SUN'))
  assert.deepEqual([...kinds({ suns: 0, locals: 0 })].filter(Boolean), ['INDIRECT'])
  lighting.dispose()
})
