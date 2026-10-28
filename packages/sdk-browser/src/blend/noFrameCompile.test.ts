// No frame compiles a transparent pipeline the scene's materials and settings reach: prepare makes
// them off the frame, a mode, share or display filter that appears later starts its own compile at
// the change (`reach.ts`), and a frame that gets there first skips the one pipeline it lacks. The
// pipelines' text cuts at a view's clip plane where the project switch is on, in one set made once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuBlendPipelines } from './pipelines.ts'
import { createDisplayFilter } from './display/displayFilter.ts'
import { mountDevice } from './translucentScene.fixture.ts'
import type { BlendGpuItem } from './state.ts'
import type { Clipping } from '../gpu/core/clipDistances.ts'
import type { LightingProgram } from '../materials/surface/blendLightSource.ts'
import { pipelineBase, variantOfBlend } from './plan/planCull.ts'
import { pipelinesCompiling } from '../lighting/deferred/compileLedger.ts'
import type { Blending } from '../../../sdk-core/src/world/constants/index.ts'

/** Counts the pipelines made by the synchronous calls a frame could reach, from now on. */
function watch(device: GPUDevice) {
  const calls = { render: 0 }
  const render = device.createRenderPipeline.bind(device)
  device.createRenderPipeline = (descriptor) => (calls.render++, render(descriptor))
  return calls
}
const settled = () => new Promise((resolve) => setImmediate(resolve))
const item = (blending: string, transmissive = false) =>
  ({ transmissive, surface: { blending, baseColor: [1, 1, 1] } }) as BlendGpuItem
/** The first pipeline rank of a mode as `item` plans it: these items are unlit, so they draw in the unlit lighting program. */
const first = (mode: Blending, lighting: LightingProgram = 'unlit') => pipelineBase(mode, lighting)

test('what the scene reaches at prepare draws with no synchronous compile', async () => {
  const mount = mountDevice()
  const items = [item('normal', true), item('multiply'), item('additive')]
  const { blendPipelines } = await createWebgpuBlendPipelines(mount.device, items, undefined, true)
  const calls = watch(mount.device)
  // The transmissive item's normal draws in the forward lighting, the others' in the unlit one.
  for (const rank of [first('normal', 'forward'), first('additive'), first('multiply')]) {
    for (const cull of [0, 1, 2]) {
      assert.ok(blendPipelines.at(rank + cull, false))
      assert.ok(blendPipelines.at(rank + cull, true), 'a filtering scene: routed')
    }
  }
  for (const cull of [0, 1, 2]) assert.ok(blendPipelines.mask.at(first('multiply') + cull))
  assert.ok(createDisplayFilter(mount.device, 4, 4))
  assert.equal(calls.render, 0)
})

test('a mode, a responsiveness or a filter reached later compiles off the frame, at the change', async () => {
  const mount = mountDevice()
  const { blendPipelines } = await createWebgpuBlendPipelines(mount.device, [item('normal')])
  const calls = watch(mount.device)
  const before = mount.renderPipelines.length
  // The responsiveness at key 1 (key 2 held the as-is share beside it, gone with the share).
  blendPipelines.reach({
    variants: [variantOfBlend('multiply', 'unlit')],
    responsive: true,
    filtered: true,
  })
  await settled()
  assert.ok(mount.renderPipelines.length > before, 'the change started its compiles')
  const made = mount.renderPipelines.length
  for (const cull of [0, 1, 2]) {
    assert.ok(blendPipelines.at(first('multiply') + cull, false))
    assert.ok(blendPipelines.at(first('multiply') + cull, false))
    assert.ok(blendPipelines.at(first('multiply') + cull, true))
    assert.ok(blendPipelines.mask.at(first('multiply') + cull))
  }
  assert.equal(calls.render, 0, 'no frame made one')
  assert.equal(mount.renderPipelines.length, made, 'nothing compiled twice')
})

test('a frame that gets there before the compile skips the pipeline, never makes it, and the frames wait for it', async () => {
  const mount = mountDevice()
  const { blendPipelines } = await createWebgpuBlendPipelines(mount.device, [item('normal')])
  const calls = watch(mount.device)
  const before = mount.renderPipelines.length
  assert.equal(
    blendPipelines.at(first('multiply') + 2, false),
    undefined,
    'multiply, never reached: skipped',
  )
  assert.equal(calls.render, 0, 'no frame made one')
  assert.equal(pipelinesCompiling(mount.device), true, 'the frames wait for the compile it asked')
  await settled()
  assert.equal(pipelinesCompiling(mount.device), false)
  assert.equal(mount.renderPipelines.length, before + 1, 'the one cull drawn, alone')
  assert.ok(blendPipelines.at(first('multiply') + 2, false), 'found made')
  assert.equal(calls.render, 0, 'once')
})

test('the pipelines of the modes a layer brings are compiled before it joins, with no frame waiting, and the frames find them made when the scene reaches them', async () => {
  const mount = mountDevice()
  const { blendPipelines } = await createWebgpuBlendPipelines(mount.device, [item('normal')])
  const calls = watch(mount.device)
  const before = mount.renderPipelines.length
  const variants = [variantOfBlend('multiply', 'unlit')]
  const next = { variants, responsive: false, refracts: false, chromatic: false, filtered: true }
  const compiling = blendPipelines.prepare(next)
  assert.equal(
    pipelinesCompiling(mount.device),
    false,
    'the frames wait for none: the layer is not in the scene',
  )
  await compiling
  assert.ok(mount.renderPipelines.length > before, 'the modes’ pipelines were compiled')
  const made = mount.renderPipelines.length
  // The scene reaches them at a frame's entry: nothing is left to compile, so no frame is held.
  blendPipelines.reach(next)
  await settled()
  assert.equal(
    pipelinesCompiling(mount.device),
    false,
    'a filtering layer holds no frame at the change of scope',
  )
  assert.equal(
    mount.renderPipelines.length,
    made,
    'nothing compiled twice, the routed modes included',
  )
  for (const cull of [0, 1, 2])
    assert.ok(blendPipelines.at(first('multiply') + cull, false), 'found made')
  assert.equal(calls.render, 0, 'no frame made one')
})

test('the project switch picks the transparents’ text once: none of the plane’s code without it, every pipeline’s with it, one set', async () => {
  const made = async (clipping?: Clipping) => {
    const mount = mountDevice()
    const items = [item('normal', true), item('multiply')]
    await createWebgpuBlendPipelines(mount.device, items, undefined, true, undefined, false, {
      clipping,
    })
    await settled()
    // The display mask's two pipelines are full-screen passes, no geometry.
    return mount.renderPipelines
      .filter(({ fragment }) => !['tint', 'add'].includes(fragment!.entryPoint!))
      .map((pipeline) => (pipeline.vertex.module as unknown as { code: string }).code)
  }
  const [off, pixel, distance] = [await made(), await made('pixel'), await made('distance')]
  assert.ok(off.length > 0 && off.every((code) => !code.includes('uni.clipPlane')))
  assert.equal(pixel.length, off.length, 'the same set: no second one for a view with a plane')
  assert.equal(distance.length, off.length)
  assert.ok(pixel.every((code) => code.includes('uni.clipPlane')))
  assert.ok(distance.every((code) => code.includes('enable clip_distances;')))
})
