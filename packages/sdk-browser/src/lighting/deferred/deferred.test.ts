import test from 'node:test'
import assert from 'node:assert/strict'
import { clearValueOf } from '../../../../sdk-core/src/world/math/packedColour.ts'
import { createDeferredLighting } from './deferred.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { gpuHarness } from './contractLighting.fixture.ts'
import { BLEND_SHADER, contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { deferredLayoutEntries } from './layoutEntries.ts'
import { limitOf, stageBindingCounts } from '../../../../../tests/kit/fakeDevice/limitRules.ts'
import { AO_QUALITY_SHAPES, AO_RANDOM_BASIS, AO_SAMPLE_SETS } from '../ao/tables.ts'
import { aoExtentOf, aoPasses, aoTargetExtent, aoTargetRect } from '../ao/plan.ts'
import { aoViewBytes } from '../ao/view.ts'
import { AO_PARAMS_BYTES } from '../ao/layout.ts'
import { HEIGHT, settingsOf, uniformOf, WIDTH } from '../ao/scene.fixture.ts'

const CLEAR = clearValueOf(0x204060)

test('composition presents and preserves the capture target in one fullscreen draw', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device)
  const capture = h.view(),
    presentation = h.view(),
    clear: GPUColor = [0.1, 0.2, 0.3, 1]
  lighting.bind(h.surface, h.view(), h.view(), false)
  lighting.compose(h.encoder, capture, clear, presentation)
  assert.equal(h.passes.length, 1)
  const attachments = h.passes[0].colors
  assert.equal(attachments.length, 2)
  assert.equal(attachments[0]!.view, capture)
  assert.equal(attachments[1]!.view, presentation)
  assert.ok(
    attachments.every((attachment) => attachment!.storeOp === 'store'),
    'both images must survive the composition pass',
  )
  assert.deepEqual(
    h.draws.map((draw) => draw.vertexCount),
    [3],
  )
  assert.deepEqual(h.passes[0].commands.at(-1), ['end', []])
  // The fake's render pipeline is its descriptor.
  const descriptor = h.draws[0].pipeline
  assert.deepEqual(
    Array.from(descriptor.fragment!.targets).map((target) => target!.format),
    ['rgba8unorm', 'bgra8unorm'],
  )
  assert.ok(
    Array.from(descriptor.fragment!.targets).every((target) => !target!.blend),
    'no additional blending may change either output',
  )
  lighting.dispose()
})

test('composition without presentation keeps its capture-only output and clear color', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device)
  const capture = h.view(),
    clear: GPUColor = [0.1, 0.2, 0.3, 1]
  lighting.bind(h.surface, h.view(), h.view(), false)
  lighting.compose(h.encoder, capture, clear)
  assert.equal(h.passes.length, 1)
  assert.deepEqual(h.passes[0].colors, [
    { view: capture, loadOp: 'clear', storeOp: 'store', clearValue: clear },
  ])
  assert.deepEqual(
    Array.from(h.draws[0].pipeline.fragment!.targets).map((target) => target!.format),
    ['rgba8unorm'],
  )
  assert.deepEqual(
    h.draws.map((draw) => draw.vertexCount),
    [3],
  )
  assert.deepEqual(h.passes[0].commands.at(-1), ['end', []])
  lighting.dispose()
})

test('diagnostic composition retains the display-space flag and unbound calls fail before encoding', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device),
    target = h.view()
  assert.throws(
    () => lighting.compose(h.encoder, target, [0, 0, 0, 1], h.view()),
    /SURFACE_NOT_BOUND/,
  )
  assert.equal(h.passes.length, 0)
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  lighting.update(matrix, [1, 2, 3], 800, 600, CLEAR, true)
  assert.deepEqual([...h.viewWrites[0].slice(20, 24)], [800, 600, 1, 0])
  lighting.update(matrix, [1, 2, 3], 800, 600, CLEAR, false)
  assert.deepEqual([...h.viewWrites[1].slice(20, 24)], [800, 600, 0, 0])
  lighting.bind(h.surface, h.view(), h.view(), false)
  lighting.dispose()
  assert.equal(h.viewDestroyed, true)
  assert.throws(
    () => lighting.compose(h.encoder, target, [0, 0, 0, 1], h.view()),
    /SURFACE_NOT_BOUND/,
  )
  assert.equal(h.passes.length, 0)
})

test('an image is composed with the share it read, one group per pair', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device)
  const hdr = h.view()
  lighting.bind(h.surface, h.view(), hdr, false)
  // The two TAA histories, each its colour beside its share, written in turn.
  const images = [0, 1].map(() => ({ color: h.view(), share: h.view() }))
  for (let frame = 0; frame < 4; frame++)
    lighting.compose(h.encoder, h.view(), [0, 0, 0, 1], undefined, images[frame % 2])
  for (let frame = 0; frame < 2; frame++) lighting.compose(h.encoder, h.view(), [0, 0, 0, 1])
  // A new surface under the same lit image: its flags are read, not the old surface's.
  const flags = [h.view(), h.view(), h.view(), h.view()],
    resized = {
      views: () => flags,
      stores: () => [flags[0], flags[3]],
    } as unknown as SurfaceBuffer
  lighting.bind(resized, h.view(), hdr, false)
  lighting.compose(h.encoder, h.view(), [0, 0, 0, 1])
  // The effect chain's target without TAA has no share of its own: it reads the flags.
  const target = h.view()
  lighting.compose(h.encoder, h.view(), [0, 0, 0, 1], undefined, { color: target })
  // A composition group reads three resources; the lighting groups read more.
  const composed = h.bindGroups
    .map((group) => Array.from(group.entries))
    .filter((entries) => entries.length === 3)
  assert.equal(composed.length, 5, 'each history, the lit image, its new flags, the effect target')
  assert.deepEqual(
    composed.map((entries) => [entries[0]!.resource, entries[2]!.resource]),
    [
      [images[0].color, images[0].share],
      [images[1].color, images[1].share],
      [hdr, h.surface.views()[3]],
      [hdr, flags[3]],
      [target, flags[3]],
    ],
  )
  lighting.dispose()
})

test('the lit pass reads the screen probes where it bounces; a program with no bounce, or a blend, knows nothing of them', () => {
  const bounced = contractLightingShader(true)
  assert.ok(bounced.includes(`@binding(${DEFERRED_BINDINGS.screenIndirect}) var screenIndirect`))
  assert.ok(bounced.includes('fn screenIndirectAt(coord:vec2i)'))
  // The pixel's choice is made where the pixel is known, in the resolve's own indirect light: no global, no flag.
  assert.equal(bounced.split('screenIndirectAt(coord)').length - 1, 1, 'read once a pixel')
  for (const text of [contractLightingShader(false), BLEND_SHADER])
    for (const word of ['screenIndirect', 'surfaceCoord']) assert.ok(!text.includes(word), word)
  assert.ok(!bounced.includes('surfaceCoord'), 'no private pixel left for the lighting to set')
  const bindings = Object.values(DEFERRED_BINDINGS)
  assert.equal(new Set(bindings).size, bindings.length, 'no two resources share a binding')
})

test('the lit pass names the screen probes result: a group is made for each result and kept for its turn', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device)
  const hdr = h.view(),
    depth = h.view(),
    turns = [h.view(), h.view()]
  const bindWith = (screenIndirect: GPUTextureView | undefined) =>
    lighting.bind(h.surface, depth, hdr, false, { screenIndirect })
  bindWith(turns[0])
  const first = h.bindGroups.length
  bindWith(turns[1])
  assert.equal(h.bindGroups.length, first + 1, 'another result: another group')
  bindWith(turns[0])
  bindWith(turns[1])
  assert.equal(h.bindGroups.length, first + 1, 'each result finds its group held')
  bindWith(undefined)
  assert.equal(h.bindGroups.length, first + 2, 'none cast: the stand-in, a group of its own')
  lighting.dispose()
})

test('the bounce layout binds the screen probes result as a sampled texture, within the default limits of its stage', () => {
  gpuHarness()
  const entries = deferredLayoutEntries(true, true)
  const screen = entries.find((entry) => entry.binding === DEFERRED_BINDINGS.screenIndirect)
  assert.ok(
    screen?.texture && !screen.storageTexture,
    'read by load, never a fifth storage texture',
  )
  assert.equal(screen?.texture?.sampleType, 'uint', 'the history it reads is words')
  const bindGroupLayouts = [{ entries }] as unknown as GPUBindGroupLayout[]
  const counts = stageBindingCounts({ bindGroupLayouts }).filter((c) => c.kind.endsWith('Fragment'))
  for (const { limit, kind, count } of counts)
    assert.ok(count <= limitOf(limit), `${count} ${kind}`)
  const storage = counts.find((c) => c.limit === 'maxStorageTexturesPerShaderStage')
  assert.equal(storage?.count, 4, 'lobes, subsurface, reflection and mask tiles')
})

test('the occlusion’s qualities, sample sets and noise directions are the reference’s', () => {
  assert.deepEqual(
    AO_QUALITY_SHAPES.map(({ sampleSet, steps, quadBlur }) => [sampleSet, steps, quadBlur]),
    [
      [1, 1, false],
      [1, 1, true],
      [1, 2, true],
      [1, 3, false],
      [3, 3, false],
    ],
  )
  assert.deepEqual(AO_SAMPLE_SETS[3][5], [0.06, 0.9])
  assert.deepEqual(
    AO_SAMPLE_SETS[1].map((p) => p.map((x) => +x.toFixed(4))),
    [
      [0, -0.43],
      [0.406, 0.5698],
      [-0.58, 0.814],
    ],
  )
  // The sixteen bytes pairs of the 4 × 4 block, read back as the noise texture holds them (checked against a float32 evaluation).
  assert.deepEqual(
    AO_RANDOM_BASIS.slice(0, 4).map((p) => p.map((x) => +x.toFixed(6))),
    [
      [0.882353, 0.003922],
      [-0.47451, 0.717647],
      [0.152941, 0.756863],
      [0.764706, 0.513725],
    ],
  )
  assert.equal(AO_RANDOM_BASIS.length, 16)
})

test('the occlusion draws as many resolutions as its quality asks, each a half of the one before', () => {
  const targets = (levels: number) => aoPasses(levels).map((p) => `${p.kind}:${p.target}`)
  assert.deepEqual(targets(1), ['final:ao'])
  assert.deepEqual(targets(2), ['setup:setup1', 'step:ao1', 'final:ao'])
  assert.deepEqual(targets(3), ['setup:setup1', 'setup:setup2', 'step:ao2', 'step:ao1', 'final:ao'])
  const last = aoPasses(3).at(-1)!
  assert.deepEqual([last.setup, last.lower], ['setup1', 'ao1'])
  assert.equal(aoPasses(3)[3].lower, 'ao2')
  // A texture is made at a multiple of eight, and its half and quarter are whole pixels.
  assert.deepEqual(aoExtentOf([1366, 768]), [1368, 768])
  assert.deepEqual(aoTargetExtent('setup2', [1368, 768]), [342, 192])
  assert.deepEqual(aoTargetRect('ao1', [1367, 767]), [684, 384])
  // The setups hold eight bytes a pixel, the occlusions one, and each pass a uniform.
  assert.equal(aoViewBytes(2, [64, 32]), 32 * 16 * 8 + 32 * 16 + 64 * 32 + 3 * AO_PARAMS_BYTES)
})

test('the occlusion’s uniform holds the reference’s numbers, the radius grown for each halving', () => {
  const words = (levels: number, pass: number) => uniformOf(levels, pass)
  const full = words(2, 2)
  // Radius 200 over the 400 units of the view, shared out by four; power 2, bias 3 a thousand, intensity 0.5, blend 0.6.
  assert.deepEqual(
    full.shape.map((x) => +x.toFixed(6)),
    [2, 0.003, 0.5, 0.6],
  )
  assert.deepEqual(
    full.radius.map((x) => +x.toFixed(6)),
    [0.125, 0, 1, 0.4],
  )
  // The half pass takes the scale once: 1.7 times the radius; its depth threshold is halved.
  const half = words(2, 1)
  assert.deepEqual(
    half.radius.map((x) => +x.toFixed(6)),
    [0.2125, 0, 2, 0.4],
  )
  assert.equal(+half.fade[2].toFixed(6), 0.005)
  assert.equal(+words(3, 2).radius[0].toFixed(6), +((0.5 * 1.7 ** 2) / 4).toFixed(6))
  // The fade: a multiplier over the fade radius and an addend that ends it at the fade distance, in centimetres.
  assert.deepEqual(
    full.fade.slice(0, 2).map((x) => +x.toFixed(6)),
    [0.0002, -0.6],
  )
  // The drawn rectangle, the texture, the coarser texture and the setup it reads.
  assert.deepEqual(half.rects, [WIDTH / 2, HEIGHT / 2, WIDTH / 2, HEIGHT / 2])
  assert.deepEqual(full.low, [WIDTH / 2, HEIGHT / 2, WIDTH / 2, HEIGHT / 2])
  assert.deepEqual(full.upper.slice(0, 2), [WIDTH / 2, HEIGHT / 2])
  // The camera looks down -z: its forward is -z; a perspective depth is near over distance.
  assert.deepEqual(
    [full.right, full.up, full.forward].map((v) => v.slice(0, 3)),
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
    ],
  )
  assert.deepEqual(
    full.depth.map((x) => +x.toFixed(6)),
    [0.1, 0, 1, 0],
  )
  // In the world's units the radius is the settings' own, in centimetres, shared out by four.
  assert.equal(
    +uniformOf(1, 0, settingsOf({ ambientOcclusionRadiusInWorldSpace: true })).radius[0].toFixed(6),
    50,
  )
})
