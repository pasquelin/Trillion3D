import test from 'node:test'
import assert from 'node:assert/strict'
import { ROW_MATERIAL_CLASS_WORD } from '../row/pageRow.ts'
import { encodeMaterialPasses } from './materialPasses.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { webgpuPagesEngine } from '../pages/pages.ts'
import { camera, quadScene } from '../pages/testScenes.fixture.ts'
import { resolveFixture } from './materialPasses.fixture.ts'
import { MATERIAL_SURFACES_PASS } from '../../stage/passLabels.ts'

const passSummary = (passes: Array<{ label: string; draws: number }>) =>
  passes.map(({ label, draws }) => [label, draws])

test('one present class shades directly into the cleared surfaces', () => {
  const { rt, device, encoder, passes } = resolveFixture([5], [5], [5])
  encodeMaterialPasses(rt, device, encoder)
  assert.deepEqual(passSummary(passes), [[MATERIAL_SURFACES_PASS, 1]])
  assert.equal(passes[0].depth, undefined)
  const colors = passes[0].colors as Array<{
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
  assert.equal(rt.run.gpuDrawCalls, 1)
})

test('a cached direct class is used only for that sole present class', () => {
  const { rt, device, encoder, passes, made, ordinary, direct } = resolveFixture(
    [5, 9],
    [5, 9],
    [5],
  )
  encodeMaterialPasses(rt, device, encoder)
  assert.deepEqual(passSummary(passes), [[MATERIAL_SURFACES_PASS, 2]])
  assert.deepEqual(passes[0].pipelines, [ordinary.get(5), ordinary.get(9)])
  assert.ok(!passes[0].pipelines.includes(direct.get(5)))
  rt.layout.rows.pageTableInts![ROW_MATERIAL_CLASS_WORD] = 9
  rt.layout.rows.packedCount = 1
  passes.length = 0
  encodeMaterialPasses(rt, device, encoder)
  assert.deepEqual(passSummary(passes), [[MATERIAL_SURFACES_PASS, 1]])
  assert.equal(passes[0].pipelines[0], ordinary.get(9))
  assert.notEqual(passes[0].pipelines[0], direct.get(5))
  assert.equal(passes[0].depth, undefined)
  assert.deepEqual(made, [], 'the resolve compiles no class: each was compiled before')
})

test('the same classes replay the surfaces bundle, a class that leaves records it again', () => {
  const { rt, device, bundles, encoder, passes } = resolveFixture([5, 9], [5, 9])
  encodeMaterialPasses(rt, device, encoder)
  encodeMaterialPasses(rt, device, encoder)
  assert.deepEqual(passSummary(passes), [
    [MATERIAL_SURFACES_PASS, 2],
    [MATERIAL_SURFACES_PASS, 2],
  ])
  assert.equal(bundles.length, 1, 'recorded by the first image, replayed by the second')
  // Recorded for the pass's attachments: the four surfaces and the feedback target.
  assert.equal([...bundles[0].descriptor.colorFormats].length, passes[0].colors.length)
  rt.layout.rows.pageTableInts![ROW_MATERIAL_CLASS_WORD] = 9
  rt.layout.rows.packedCount = 1
  encodeMaterialPasses(rt, device, encoder)
  assert.equal(bundles.length, 2, 'one class left: its stream is recorded again')
  assert.equal(passes[2].draws, 1)
})

// A held frame keys the bundle by the class set and the present classes' stamp: it looks up no
// class pipeline, however many classes the image holds.
test('a frame over the same classes replays without looking up a class pipeline', () => {
  const { rt, device, encoder } = resolveFixture([5, 9, 2], [5, 9, 2])
  const classes = rt.vis.shadeClasses!,
    of = classes.of.bind(classes)
  let looked = 0
  classes.of = (key) => (looked++, of(key))
  encodeMaterialPasses(rt, device, encoder)
  assert.equal(looked, 3, 'the recording walks each class once')
  for (let frame = 0; frame < 4; frame++) encodeMaterialPasses(rt, device, encoder)
  assert.equal(looked, 3, 'held frames: none')
})

test('an empty class census retains the pass that clears the surfaces, and draws nothing', () => {
  const { rt, device, encoder, passes } = resolveFixture([], [])
  encodeMaterialPasses(rt, device, encoder)
  assert.deepEqual(passSummary(passes), [[MATERIAL_SURFACES_PASS, 0]])
  assert.equal(rt.run.gpuDrawCalls, 0)
})

test('an image draws each class of its rows once in one pass without depth, from the class set', () => {
  const { rt, device, encoder, passes, made, ordinary } = resolveFixture([5, 9, 5, 2], [5, 9, 2])
  encodeMaterialPasses(rt, device, encoder)
  // One pass: no material depth is written or tested, each class keeps its own pixels.
  assert.deepEqual(passSummary(passes), [[MATERIAL_SURFACES_PASS, 3]])
  const [surfaces] = passes
  // Rows of class 5 twice: one draw; each class drawn with its compiled pipeline.
  assert.deepEqual(surfaces.pipelines, [ordinary.get(5), ordinary.get(9), ordinary.get(2)])
  assert.equal(surfaces.depth, undefined)
  assert.deepEqual(made, [])
  assert.equal(rt.run.gpuDrawCalls, 3, 'one draw per class present')
})

test('a resolve without its bind group fails by name instead of drawing nothing', () => {
  const { rt, device, encoder } = resolveFixture([5], [5])
  rt.vis.shadeBindGroup = undefined
  assert.throws(() => encodeMaterialPasses(rt, device, encoder), /MATERIAL_RESOLVE_UNAVAILABLE/)
})

test('a backend makes no material depth, its class pipelines test no depth, and disposing destroys the visibility target', async () => {
  installGpuGlobals()
  const { device, textures, renderPipelines } = mockGpu()
  const { source, metadata, indices, associations } = quadScene()
  const backend = webgpuPagesEngine({
    source,
    metadata,
    indices,
    associations,
    gpuDevice: device,
    maxResidentPages: 2,
    viewport: [32, 32],
  })
  await backend.prepare()
  backend.render(camera())
  assert.ok(!textures.some(({ label }) => label === 'Trillion3D material depth'))
  const classes = renderPipelines.filter(({ fragment }) =>
    fragment?.entryPoint?.startsWith('shade_'),
  )
  assert.ok(classes.length > 0)
  for (const { depthStencil, fragment } of classes)
    assert.equal(depthStencil, undefined, `${fragment?.entryPoint} tests no depth`)
  assert.ok(!renderPipelines.some(({ fragment }) => fragment?.entryPoint === 'material_depth_fs'))
  const [ids] = textures.filter(({ label }) => label === 'Trillion3D visibility')
  assert.equal(ids.destroyed, false)
  backend.dispose()
  assert.equal(ids.destroyed, true)
})
