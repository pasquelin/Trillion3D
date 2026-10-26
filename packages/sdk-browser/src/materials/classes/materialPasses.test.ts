import { createGraphFrame } from '../../frame/render/graphFrame.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeMaterialPasses } from './materialPasses.ts'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { BACKEND } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { webgpuPagesEngine } from '../../frame/backend/pages.ts'
import { camera, quadScene } from '../../frame/backend/testScenes.fixture.ts'
import { drawsOf, pipelinesOf, resolveFixture } from './materialPasses.fixture.ts'
import type { FakePass } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { MATERIAL_COMPUTE_PASS, MATERIAL_SURFACES_PASS } from '../../diagnostic/stage/passLabels.ts'
import { graphDraws } from '../../geometry/selection/drawSource.ts'
import { createTextureCaches } from '../texture/textureCaches.ts'
import { createPageCache } from '../../geometry/streaming/pageCache.ts'
import { commandArgs } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import { noteClass } from '../../gpu/core/presentClasses.ts'
import { SHADE_UNIFORM } from '../../visibility/shader/uniformLayout.ts'
import { PRISM_UNIFORM } from '../../visibility/tessellation/prismWgsl.ts'

const passSummary = (passes: FakePass[]) => passes.map((pass) => [pass.label, drawsOf(pass)])

test('one present class shades its bin into the surfaces the pass of no draw cleared', () => {
  const { rt, encoder, passes, computePasses, ordinary, bins } = resolveFixture([5], [5])
  encodeMaterialPasses(rt, encoder)
  assert.deepEqual(passSummary(passes), [[MATERIAL_SURFACES_PASS, 0]])
  assert.equal(passes[0].depth, undefined)
  const colors = passes[0].colors as unknown as Array<{
    view: unknown
    loadOp: string
    storeOp: string
    clearValue?: unknown
  }>
  assert.deepEqual(
    colors.map(({ view, loadOp, storeOp }) => [view, loadOp, storeOp]),
    [
      ['a', 'clear', 'store'],
      ['b', 'clear', 'store'],
      ['c', 'clear', 'store'],
      ['d', 'clear', 'store'],
      ['feedback', 'clear', 'store'],
    ],
  )
  for (const { clearValue } of colors.slice(0, 4)) assert.deepEqual(clearValue, [0, 0, 0, 0])
  assert.equal(rt.run.feedbackWritten, true)
  // Then the compute pass: the bins of the image, and the class's one dispatch of its bin.
  assert.deepEqual(
    computePasses.map(({ label }) => label),
    [MATERIAL_COMPUTE_PASS],
  )
  assert.deepEqual(pipelinesOf(computePasses[0]), [ordinary.get(5)])
  assert.deepEqual(bins.assigned, [[5]])
  assert.deepEqual(bins.laid, [[8, 4]])
  assert.deepEqual(bins.shaded, [0])
  assert.equal(rt.run.gpuComputeDispatches, 4 + 1)
})

test('an empty class census retains the pass that clears the surfaces, and shades nothing', () => {
  const { rt, encoder, passes, bins } = resolveFixture([], [])
  encodeMaterialPasses(rt, encoder)
  assert.deepEqual(passSummary(passes), [[MATERIAL_SURFACES_PASS, 0]])
  assert.equal(bins.binned, 0)
  assert.deepEqual(bins.shaded, [])
  assert.equal(rt.run.gpuComputeDispatches, 0)
})

test('an image shades each class of its clusters once, one dispatch of its bin, from the class set', () => {
  const { rt, encoder, passes, computePasses, made, ordinary, bins } = resolveFixture(
    [5, 9, 5, 2],
    [5, 9, 2],
  )
  encodeMaterialPasses(rt, encoder)
  // No material depth is written or tested: each class shades its own bin.
  assert.equal(passes[0].depth, undefined)
  // Clusters of class 5 twice: one bin, one dispatch; the classes in increasing order, each with
  // its compiled pipeline.
  assert.deepEqual(bins.assigned, [[2, 5, 9]])
  assert.deepEqual(pipelinesOf(computePasses[0]), [
    ordinary.get(2),
    ordinary.get(5),
    ordinary.get(9),
  ])
  assert.deepEqual(bins.shaded, [0, 1, 2])
  assert.deepEqual(made, [])
  assert.equal(rt.run.gpuComputeDispatches, 4 + 3, 'the bins, then one dispatch per class present')
})

test('a resolve without its bind group fails by name instead of drawing nothing', () => {
  const { rt, encoder } = resolveFixture([5], [5])
  rt.vis.shadeBindGroup = undefined
  assert.throws(() => encodeMaterialPasses(rt, encoder), /MATERIAL_RESOLVE_UNAVAILABLE/)
})

test('a backend makes no material depth, its classes are compute stages, and disposing destroys the visibility target', async () => {
  installGpuGlobals()
  const { device, textures, renderPipelines, computePipelines, destroyed } = fakeDevice(BACKEND)
  const { source, metadata, indices, associations } = quadScene()
  const backend = webgpuPagesEngine({
    textureCaches: createTextureCaches(createPageCache()),
    source,
    metadata,
    indices,
    draws: graphDraws(source, associations),
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  await backend.prepare()
  backend.render(camera())
  assert.ok(!textures.some(({ label }) => label === 'Trillion3D material depth'))
  assert.ok(computePipelines.some(({ compute }) => compute.entryPoint === 'shade_cs'))
  assert.ok(!renderPipelines.some(({ fragment }) => fragment?.entryPoint?.startsWith('shade_')))
  assert.ok(!renderPipelines.some(({ fragment }) => fragment?.entryPoint === 'material_depth_fs'))
  const [ids] = textures.filter(({ label }) => label === 'Trillion3D visibility')
  assert.equal(destroyed.includes(ids), false)
  backend.dispose()
  assert.equal(destroyed.includes(ids), true)
})

test('a class that draws displaced pixels shades over its own group and pipeline, the others over the resolve’s', () => {
  const { rt, device, writes, encoder, computePasses, ordinary, bins } = resolveFixture(
    [5, 9, 5],
    [5, 9],
  )
  // Class 5 holds a displaced cluster the image tessellates; class 9 none.
  noteClass(rt.vis.displacedClasses, 5, 1)
  const token = () => ({}) as GPUBuffer
  const atlas = () => ({ views: [{}, {}, {}], pages: { buffer: token() } })
  Object.assign(rt.vis, {
    materialTable: { displaced: { count: 1 }, view: {} },
    visView: {},
    concatPos: token(),
    concatUv: token(),
    concatNrm: {},
    pageTable: token(),
    textures: { color: atlas(), data: atlas() },
    mapsSampler: {},
    shadeUniform: token(),
    graphFrame: createGraphFrame(),
    voxelSteps: { buffer: token() },
    shadeUniPacked: new Float32Array(SHADE_UNIFORM.words).map((_, i) =>
      i < 16 && i % 5 === 0 ? 1 : 0,
    ),
  })
  Object.assign(rt.gpu, {
    device,
    cache: { buffer: token() },
    depthView: {},
    surfaces: { views: () => ['a', 'b', 'c', 'd'], lobesView: {} },
  })
  Object.assign(rt.run, { gate: { cam: { eye: [0, 0, 0] } } })
  const classes = rt.vis.shadeClasses as unknown as Record<string, unknown>
  classes.displaced = (key: number) => ({ get: () => ({ displaced: key }) })
  encodeMaterialPasses(rt, encoder)
  const groups = commandArgs(computePasses[0].commands, 'setBindGroup').map(([index, group]) => [
    index,
    group === 'bind group' ? 'resolve' : group === 'output group' ? 'output' : 'displaced',
  ])
  // The outputs first, then each class's group 0 as it needs it, set again only where it changes.
  assert.deepEqual(groups, [
    [1, 'output'],
    [0, 'displaced'],
    [0, 'resolve'],
  ])
  assert.deepEqual(pipelinesOf(computePasses[0]), [{ displaced: 5 }, ordinary.get(9)])
  assert.deepEqual(bins.shaded, [0, 1])
  // The view's numbers went up first: the inverse of the shade uniform's matrix (the identity here),
  // the eye, the frame tessellating, the pixels it draws.
  const sent = writes.find(
    (w) => (w.buffer as { label?: string }).label === 'Trillion3D displaced resolve',
  )
  const words = new Float32Array(sent!.data.buffer, sent!.data.byteOffset, PRISM_UNIFORM.words)
  const at = PRISM_UNIFORM.at
  assert.deepEqual(
    Array.from(words.slice(at.invViewProj, at.invViewProj + 16)),
    Array.from(rt.vis.shadeUniPacked.slice(0, 16)),
  )
  assert.deepEqual(Array.from(words.slice(at.viewport, at.viewport + 2)), [8, 4])
  assert.equal(new Uint32Array(words.buffer, words.byteOffset, words.length)[at.tessellation], 1)
})
