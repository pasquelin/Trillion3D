// The responsiveness the transparents carry into the temporal pass, in a target of its own. A
// blended scene whose blends carry none, or with no temporal pass, draws exactly what it drew before
// that target: no clear pass, no target, no attachment in the transparent pass. (This file tested
// the as-is share a debug view read beside it; the share is gone — a debug view's as-is pixels are
// composed after the temporal pass from the surfaces, as the reference's buffer visualisation —,
// so the responsiveness is its subject alone.)
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { clearResponsive, wantsResponsive } from './responsiveTarget.ts'
import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts'
import { drawBlendPass } from '../../blend/draw.ts'
import type { BlendGpuItem } from '../../blend/state.ts'
import {
  mountDevice,
  prepared,
  replay,
  targets,
  writesOf,
} from '../../blend/translucentScene.fixture.ts'
import type { FakePass } from '../../../../../tests/kit/fakeDevice/fakeRenderPass.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import { reflectionFront } from '../../lighting/reflections/frontDepth.fixture.ts'

/** A blended image whose targets are made, on the kit's device and one of its encoders. */
function blendedImage() {
  const rt = {
    vis: { blendPipelines: {}, asIsShown: false },
    run: { diagnostic: 'beauty' },
    context: {},
    blendState: { blendGpu: [{}] },
    gpu: {
      reflection: reflectionFront(),
      temporalLevel: 'off',
      surfaces: { views: () => [{}, {}, {}, {}] },
      allocatedSize: [8, 4],
      targetBytes: 100,
    },
  } as unknown as WebgpuPagesRuntime
  const { device: gpuDevice, textures, destroyed, passes } = fakeDevice()
  return { rt, encoder: gpuDevice.createCommandEncoder(), passes, gpuDevice, textures, destroyed }
}
/** The label of each pass begun. */
const labelsOf = (passes: FakePass[]) => passes.map(({ label }) => label)
/** Each pass's targets' load and clear, and its commands. */
const loadsOf = (passes: FakePass[]) =>
  passes.map(({ colors, commands }) => [
    colors.map((target) => [target?.loadOp, target?.clearValue]),
    commands.map(([name]) => name),
  ])

test('a blended scene runs no clear and makes no responsive target unless the temporal pass reads one', () => {
  const { rt, encoder, passes, gpuDevice, textures } = blendedImage()
  assert.equal(clearResponsive(rt, gpuDevice, encoder), undefined)
  // A debug view shown makes nothing: its as-is pixels are read from the surfaces.
  rt.vis.asIsShown = true
  assert.equal(clearResponsive(rt, gpuDevice, encoder), undefined)
  rt.gpu.temporalLevel = 'max'
  assert.equal(clearResponsive(rt, gpuDevice, encoder), undefined, 'blends that carry none')
  assert.deepEqual(labelsOf(passes), [], 'no clear pass')
  assert.equal(textures.length, 0, 'no responsive target')
  assert.equal(rt.gpu.targetBytes, 100, 'nothing more costed')
  // A blend that carries a responsiveness under the temporal pass: made once, costed, cleared every
  // image, by a pass that draws nothing.
  rt.blendState.responsive = true
  const responsive = clearResponsive(rt, gpuDevice, encoder)
  assert.ok(responsive)
  assert.equal(clearResponsive(rt, gpuDevice, encoder), responsive, 'kept with the targets')
  assert.deepEqual(
    textures.map(({ format, size }) => [format, size]),
    [['r8unorm', { width: 8, height: 4 }]],
  )
  assert.equal(rt.gpu.targetBytes, 100 + 8 * 4)
  assert.deepEqual(labelsOf(passes), [
    'Trillion3D responsiveness clear',
    'Trillion3D responsiveness clear',
  ])
  assert.ok(
    loadsOf(passes).every((load) => JSON.stringify(load) === '[[["clear",[0,0,0,0]]],["end"]]'),
  )
})

test('the responsiveness pass is drawn under the temporal pass alone, into the responsive target alone', () => {
  const { blendState, gpu, device } = prepared()
  targets(gpu)
  gpu.temporalLevel = 'off'
  const { rt, encoder, passes } = replay(blendState, gpu)
  const asked: number[] = []
  rt.vis.blendPipelines = {
    at: () => ({}),
    responsive: { at: (rank: number) => (asked.push(rank), {}) },
    lit() {
      return this
    },
    reach: () => undefined,
  } as unknown as WebgpuPagesRuntime['vis']['blendPipelines']
  rt.blendState.responsive = true
  drawBlendPass(rt, device, encoder)
  // No temporal pass reads it: no pass, no pipeline, and no colour pass attachment for it.
  assert.ok(!labelsOf(passes).includes('Trillion3D blend responsiveness'))
  assert.equal(asked.length, 0)
  assert.ok(passes.every((pass) => pass.colors.length <= 4))
  // Under the temporal pass the layers are drawn again into it, with the pipelines of the pass.
  rt.gpu.temporalLevel = 'max'
  passes.length = 0
  drawBlendPass(rt, device, encoder)
  const marked = passes.find(({ label }) => label === 'Trillion3D blend responsiveness')!
  assert.ok(marked && asked.length)
  assert.deepEqual(writesOf(marked), [gpu.responsive!.view])
})

test('the blend pipelines compile the responsiveness pass only for an image that writes it', async () => {
  const items = [{ transmissive: false, surface: { blending: 'normal' } }] as BlendGpuItem[]
  const plain = mountDevice()
  const built = await createWebgpuBlendPipelines(plain.device, items)
  // The blend's three, and the front stage's, compiled with the scene's transparents (`frontStage.ts`).
  assert.deepEqual(plain.pipelines, ['fs', 'fs', 'fs', 'fsFront', 'fsFront', 'fsFront'])
  assert.equal(plain.formats('fs').length, 4, 'no responsive slot in the colour pass')
  built.blendPipelines.responsive.at(0)
  assert.equal(plain.pipelines.at(-1), 'fsBlendResponsive', 'the pass compiles at its first draw')
  const responsive = mountDevice()
  await createWebgpuBlendPipelines(responsive.device, items, undefined, true, undefined, true)
  assert.deepEqual(responsive.formats('fsBlendResponsive'), ['r8unorm'], 'precompiled with it')
})

// The responsiveness exists only while an image wants it; the temporal pass turned off
// mid-session releases it and its cost, and turned on again clears a fresh one before anything reads
// it. Particles carry none.
test('the temporal pass turned off releases the responsiveness; turned on, a fresh one is cleared', () => {
  const { rt, encoder, passes, gpuDevice, destroyed } = blendedImage()
  rt.gpu.temporalLevel = 'max'
  rt.blendState.responsive = true
  const first = clearResponsive(rt, gpuDevice, encoder)
  assert.ok(first)
  assert.equal(wantsResponsive(rt), true)
  rt.gpu.temporalLevel = 'off'
  assert.equal(wantsResponsive(rt), false)
  assert.equal(clearResponsive(rt, gpuDevice, encoder), undefined, 'nothing reads a stale one')
  assert.equal(rt.gpu.responsive, undefined, 'released')
  assert.equal(destroyed.length, 1, 'its texture destroyed')
  assert.equal(rt.gpu.targetBytes, 100, 'its cost with it')
  rt.gpu.temporalLevel = 'max'
  const second = clearResponsive(rt, gpuDevice, encoder)
  assert.ok(second && second !== first, 'a fresh one')
  rt.blendState.blendGpu = []
  rt.context.particles = [] as unknown as WebgpuPagesRuntime['context']['particles']
  assert.equal(clearResponsive(rt, gpuDevice, encoder), undefined, 'particles alone write none')
  assert.equal(passes.length, 2)
})
