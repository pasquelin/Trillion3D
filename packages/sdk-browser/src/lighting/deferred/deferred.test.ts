import test from 'node:test'
import assert from 'node:assert/strict'
import { clearValueOf } from '../../../../sdk-core/src/world/math/packedColour.ts'
import { createDeferredLighting } from './deferred.ts'
import type { SurfaceBuffer } from '../../materials/surface/surfaceBuffer.ts'
import { gpuHarness } from './contractLighting.fixture.ts'
import { BLEND_SHADER, contractLightingShader } from '../../gpu/core/shaderTexts.fixture.ts'
import { DEFERRED_BINDINGS } from './bindings.ts'
import { FULL_CONTRACT } from './contractCuts.ts'
import { MAX_10_BIT_FLOAT } from '../../../../math/src/constants.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { LIT_PIXEL_WGSL } from './litSurfaceWgsl.ts'
import { retryLanded } from './compileLedger.ts'

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

// Every image is composed with the surfaces' flags and base colour, a debug view's as-is pixels drawn
// from them after the temporal pass (a TAA history was composed with the share it accumulated, the
// lit image with the flags).
test('an image is composed with the surface flags and base colour, one group per image and surface', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device)
  const hdr = h.view()
  lighting.bind(h.surface, h.view(), hdr, false)
  // The two TAA histories, written in turn.
  const images = [0, 1].map(() => ({ color: h.view() }))
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
  // The effect chain's target without TAA reads the same.
  const target = h.view()
  lighting.compose(h.encoder, h.view(), [0, 0, 0, 1], undefined, { color: target })
  // A composition group reads the image first.
  const read = new Set<unknown>([...images.map(({ color }) => color), hdr, target])
  const composed = h.bindGroups
    .map((group) => Array.from(group.entries))
    .filter((entries) => read.has(entries[0]!.resource))
  assert.equal(
    composed.length,
    5,
    'each history, the lit image, its new surface, the effect target',
  )
  const [base, flagsOf] = [h.surface.views()[0], h.surface.views()[3]]
  assert.deepEqual(
    composed.map((entries) => entries.map(({ resource }) => resource).filter((r, i) => i !== 1)),
    [
      [images[0].color, flagsOf, base],
      [images[1].color, flagsOf, base],
      [hdr, flagsOf, base],
      [hdr, flags[3], flags[0]],
      [target, flags[3], flags[0]],
    ],
  )
  lighting.dispose()
})

test('the lit pass reads the screen probes where it bounces; a program with no bounce, or a blend, knows nothing of them', () => {
  const bounced = contractLightingShader(true)
  assert.ok(bounced.includes(`@binding(${DEFERRED_BINDINGS.screenIndirect}) var screenIndirect`))
  assert.ok(bounced.includes('fn screenIndirectAt(coord:vec2i)'))
  // The pixel's choice is made where the pixel is known, in the resolve's own indirect light and in its irradiance view: no global, no flag.
  assert.equal(
    bounced.split('screenIndirectAt(coord)').length - 1,
    2,
    'read where the pixel is known',
  )
  assert.ok(!bounced.includes('bounceGrid') && !bounced.includes('cellTable'), 'and no world probe')
  for (const text of [contractLightingShader(false), BLEND_SHADER])
    for (const word of ['screenIndirect', 'surfaceCoord']) assert.ok(!text.includes(word), word)
  assert.ok(!bounced.includes('surfaceCoord'), 'no private pixel left for the lighting to set')
  const bindings = Object.values(DEFERRED_BINDINGS)
  assert.equal(new Set(bindings).size, bindings.length, 'no two resources share a binding')
})

test('the indirect pass names the screen probes result: a group is made for each result and kept for its turn', async () => {
  const h = gpuHarness(),
    lighting = await createDeferredLighting(h.device, undefined, {
      precompile: true,
      bounce: true,
      key: { ...FULL_CONTRACT, lobeless: true },
    })
  const hdr = h.view(),
    depth = h.view(),
    turns = [h.view(), h.view()]
  const bounced = { lights: {} as GPUBuffer, bounceGrid: {} as GPUBuffer }
  const frame = (screenIndirect: GPUTextureView | undefined) => {
    lighting.bind(h.surface, depth, hdr, true, { ...bounced, screenIndirect })
    lighting.light(h.encoder, hdr)
    // What the frame bound, read right after it.
    return !!lighting.litProgram?.bounce
  }
  // The bounce program asked, and compiled: the frames before it are lit by the one without bounce.
  assert.equal(lighting.bounceReady(bounced), false, 'not yet the program lent')
  assert.equal(frame(turns[0]), false, 'bound, not yet picked')
  await lighting.settle()
  assert.equal(frame(turns[0]), true, 'compiled: the frame binds the bounce program')
  assert.equal(lighting.bounceReady(bounced), true)
  const first = h.bindGroups.length
  assert.equal(frame(turns[1]), true)
  assert.equal(h.bindGroups.length, first + 1, 'another result: another group, the indirect pass’s')
  assert.equal(frame(turns[0]), true)
  assert.equal(frame(turns[1]), true)
  assert.equal(h.bindGroups.length, first + 1, 'each result finds its group held')
  assert.equal(frame(undefined), true)
  assert.equal(h.bindGroups.length, first + 2, 'none cast: the stand-in, a group of its own')
  lighting.dispose()
})

test('a light term in the lit image is multiplied by the pre-exposure and not held: only the base pass holds the emission', () => {
  const { lightOut } = shaderRun<{ lightOut: (rgb: number[]) => number[] }>(
    LIT_PIXEL_WGSL,
    ['lightOut'],
    { view: { views: [0, 0, 0, 0], preExposure: [2, 0, 0, 0] }, scatterLuma: 0 },
  )
  // Above what the emission may be (`MAX_EMISSIVE`, half the 10-bit float's greatest) once multiplied.
  assert.deepEqual(lightOut([MAX_10_BIT_FLOAT, 1, 0]), [2 * MAX_10_BIT_FLOAT, 2, 0, 0])
})

test('a pipeline that lands on a retry redraws a view at rest, as a program that lands does; a lighting released hears no more', async () => {
  const h = gpuHarness()
  let redraws = 0
  const lighting = await createDeferredLighting(h.device, () => redraws++)
  retryLanded(h.device)
  assert.equal(redraws, 1)
  lighting.dispose()
  retryLanded(h.device)
  assert.equal(redraws, 1)
})

test('a lighting whose construction throws leaves no retry hearer behind', async () => {
  const h = gpuHarness()
  let redraws = 0
  const create = h.device.createBuffer.bind(h.device)
  h.device.createBuffer = (descriptor) => {
    if (descriptor.label === 'Trillion3D tile draws') throw new Error('REFUSED')
    return create(descriptor)
  }
  await assert.rejects(
    createDeferredLighting(h.device, () => redraws++),
    /REFUSED/,
  )
  retryLanded(h.device)
  assert.equal(redraws, 0, 'nobody hears the retries of a lighting that was never made')
})
