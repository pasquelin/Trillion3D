// The transparents' as-is share keeps a debug view untouched under a lit transparent. A
// blended scene with no debug view must draw exactly what it drew before that share: no seed pass,
// no share target, no share attachment in the transparent pass.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/gpu/fakeDevice.ts'
import { seedAsIsShare } from './asIsShareTarget.ts'
import { createWebgpuBlendPipelines } from '../../blend/pipelines.ts'
import { drawBlendPass } from '../../blend/draw.ts'
import type { BlendGpuItem } from '../../blend/state.ts'
import {
  device,
  mountDevice,
  prepared,
  replay,
  targets,
  writesOf,
} from '../../water/pass.fixture.ts'
import type { MockPass } from '../../../../../../tests/kit/gpu/mockRenderPass.ts'
import type { WebgpuPagesRuntime } from '../runtime.ts'
import { reflectionFront } from '../../../reflections/frontDepth.fixture.ts'

/** A blended image whose targets are made, on the kit's device and one of its encoders. */
function blendedImage() {
  const rt = {
    vis: { blendPipelines: {}, asIsShown: false },
    run: { diagnostic: 'beauty' },
    context: {},
    blendState: { blendGpu: [{}] },
    gpu: {
      reflection: reflectionFront(),
      temporalWanted: false,
      surfaces: { views: () => [{}, {}, {}, {}] },
      allocatedSize: [8, 4],
      targetBytes: 100,
    },
  } as unknown as WebgpuPagesRuntime
  const { device: gpuDevice, textures, destroyed, passes } = fakeDevice()
  return { rt, encoder: gpuDevice.createCommandEncoder(), passes, gpuDevice, textures, destroyed }
}
/** The label of each pass begun. */
const labelsOf = (passes: MockPass[]) => passes.map(({ label }) => label)
/** The commands the last pass took, by name. */
const lastCommands = (passes: MockPass[]) => passes.at(-1)!.commands.map(([name]) => name)
/** Each pass's first target's load and clear. */
const loadsOf = (passes: MockPass[]) =>
  passes.map(({ colors: [target] }) => [target?.loadOp, target?.clearValue])

test('a blended scene with no debug view runs no share pass and makes no share target', () => {
  const { rt, encoder, passes, gpuDevice, textures } = blendedImage()
  assert.equal(seedAsIsShare(rt, gpuDevice, encoder), undefined)
  assert.deepEqual(labelsOf(passes), [], 'no seed pass')
  assert.equal(textures.length, 0, 'no share target')
  assert.equal(rt.gpu.targetBytes, 100, 'nothing more costed')
  // A debug view shown: the share is made once, costed, and seeded every image.
  rt.vis.asIsShown = true
  const share = seedAsIsShare(rt, gpuDevice, encoder)
  assert.ok(share)
  assert.equal(seedAsIsShare(rt, gpuDevice, encoder), share, 'kept with the targets')
  assert.deepEqual(
    textures.map(({ format, size }) => [format, size]),
    [['rg8unorm', { width: 8, height: 4 }]],
  )
  assert.equal(rt.gpu.targetBytes, 100 + 8 * 4 * 2)
  assert.deepEqual(labelsOf(passes), ['Trillion3D as-is share seed', 'Trillion3D as-is share seed'])
})

test('without a debug view the transparent pass binds no share and draws the shareless pipelines', () => {
  const { blendState, gpu } = prepared()
  targets(gpu)
  const { rt, encoder, passes } = replay(blendState, gpu)
  const asked: (boolean | undefined)[] = []
  rt.vis.blendPipelines = {
    at: (_rank: number, _filtered?: boolean, share?: boolean) => (asked.push(share), {}),
    lit() {
      return this
    },
    reach: () => undefined,
  } as unknown as WebgpuPagesRuntime['vis']['blendPipelines']
  drawBlendPass(rt, device, encoder)
  assert.equal(writesOf(passes[0])[2], undefined, 'the share slot stays empty')
  assert.ok(!writesOf(passes[0]).includes(gpu.asIsShare!.view))
  assert.ok(asked.length && asked.every((share): boolean => share === false))
  // A debug view shown: the pass blends into the share, with the pipelines that write it.
  rt.vis.asIsShown = true
  asked.length = 0
  drawBlendPass(rt, device, encoder)
  assert.equal(writesOf(passes[1])[2], gpu.asIsShare!.view)
  assert.ok(asked.length && asked.every((share): boolean => share === true))
})

test('the blend pipelines compile the share target only for an image that can show a debug view', async () => {
  const items = [{ transmissive: false, surface: { blending: 'normal' } }] as BlendGpuItem[]
  const plain = mountDevice()
  const built = await createWebgpuBlendPipelines(plain.device, items)
  assert.deepEqual(plain.pipelines, ['fs', 'fs', 'fs'])
  assert.equal(plain.formats('fs')[2], undefined, 'an empty slot, no share target')
  built.blendPipelines.at(0, false, true)
  assert.equal(plain.pipelines.length, 6, 'the share set compiles at its first draw')
  const debug = mountDevice()
  await createWebgpuBlendPipelines(debug.device, items, undefined, true, undefined, true)
  assert.equal(debug.formats('fs')[2], 'rg8unorm', 'precompiled with the share')
})

// The temporal pass reads the blends' and particles' coverage from the same target.
test('a temporal image or particles alone seed the share, as the reactive value', () => {
  const { rt, encoder, passes, gpuDevice } = blendedImage()
  rt.gpu.temporalWanted = true
  assert.ok(seedAsIsShare(rt, gpuDevice, encoder), 'blends under the temporal pass')
  rt.gpu.temporalWanted = false
  rt.blendState.blendGpu = []
  assert.equal(seedAsIsShare(rt, gpuDevice, encoder), undefined, 'nothing writes it')
  rt.context.particles = [] as unknown as WebgpuPagesRuntime['context']['particles']
  assert.ok(seedAsIsShare(rt, gpuDevice, encoder), 'particles alone')
  assert.equal(passes.length, 2)
})

// The share exists only while an image wants it; a debug view turned off mid-session
// releases it and its cost, and one turned on again seeds a fresh share before anything reads it.
test('a debug view turned off mid-session releases the share; turned on, a fresh one is seeded', () => {
  const { rt, encoder, passes, gpuDevice, destroyed } = blendedImage()
  rt.vis.asIsShown = true
  const first = seedAsIsShare(rt, gpuDevice, encoder)
  assert.ok(first)
  assert.equal(rt.gpu.targetBytes, 100 + 8 * 4 * 2)
  rt.vis.asIsShown = false
  assert.equal(seedAsIsShare(rt, gpuDevice, encoder), undefined, 'nothing reads a stale share')
  assert.equal(rt.gpu.asIsShare, undefined, 'released')
  assert.equal(destroyed.length, 1, 'its texture destroyed')
  assert.equal(rt.gpu.targetBytes, 100, 'its cost with it')
  rt.vis.asIsShown = true
  const second = seedAsIsShare(rt, gpuDevice, encoder)
  assert.ok(second && second !== first, 'a fresh share')
  assert.equal(rt.gpu.targetBytes, 100 + 8 * 4 * 2)
  assert.deepEqual(labelsOf(passes), ['Trillion3D as-is share seed', 'Trillion3D as-is share seed'])
})

// S19.3: without a row shown as-is or a diagnostic view, the flags hold no as-is pixel, so the
// seed's draw would write the clear's zeros again: the share is cleared to 0 and nothing is drawn.
test('an image with no as-is pixel clears the share to zero and draws no seed', () => {
  const { rt, encoder, passes, gpuDevice } = blendedImage()
  rt.gpu.temporalWanted = true
  assert.ok(seedAsIsShare(rt, gpuDevice, encoder), 'the reactive value still needs it')
  assert.deepEqual(lastCommands(passes), ['end'], 'no pipeline, no draw')
  assert.deepEqual(loadsOf(passes), [['clear', [0, 0, 0, 0]]])
  rt.blendState.blendGpu = []
  rt.context.particles = [] as unknown as WebgpuPagesRuntime['context']['particles']
  assert.ok(seedAsIsShare(rt, gpuDevice, encoder), 'particles alone')
  assert.deepEqual(lastCommands(passes), ['end'])
  // A row shown as-is, or a diagnostic view, under blends: the flags seed it.
  rt.blendState.blendGpu = [{}] as WebgpuPagesRuntime['blendState']['blendGpu']
  for (const shown of [{ asIsShown: true }, { diagnostic: 'normals' }]) {
    rt.vis.asIsShown = false
    rt.run.diagnostic = 'beauty'
    Object.assign('asIsShown' in shown ? rt.vis : rt.run, shown)
    assert.ok(seedAsIsShare(rt, gpuDevice, encoder))
    assert.deepEqual(lastCommands(passes), ['setPipeline', 'setBindGroup', 'draw', 'end'])
  }
  assert.ok(loadsOf(passes).every((load) => JSON.stringify(load) === '["clear",[0,0,0,0]]'))
})
