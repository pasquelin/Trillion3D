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

test('an image shades each class of its rows once, one dispatch of its bin, from the class set', () => {
  const { rt, encoder, passes, computePasses, made, ordinary, bins } = resolveFixture(
    [5, 9, 5, 2],
    [5, 9, 2],
  )
  encodeMaterialPasses(rt, encoder)
  // No material depth is written or tested: each class shades its own bin.
  assert.equal(passes[0].depth, undefined)
  // Rows of class 5 twice: one bin, one dispatch; each class with its compiled pipeline.
  assert.deepEqual(bins.assigned, [[5, 9, 2]])
  assert.deepEqual(pipelinesOf(computePasses[0]), [
    ordinary.get(5),
    ordinary.get(9),
    ordinary.get(2),
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
