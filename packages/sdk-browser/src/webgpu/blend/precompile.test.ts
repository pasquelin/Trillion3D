// The blending modes a scene declares are compiled off the frame, at prepare, on both transparent
// paths: the first draw in such a mode finds its pipeline and compiles nothing. What is compiled is
// what the draw would have compiled itself, descriptor for descriptor: the image cannot change.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { BLEND_MODES, hostBlending } from '../../scene/materialBlending.ts'
import { createWebgpuPagesPipelines } from '../pages/prepare/pipelines.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import { declaredBlendModes, pipelinesByMode } from './stagePipelines.ts'
import type { BlendGpuItem } from './state.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'

/** Blend items as prepare leaves them, one per host blending constant. */
function items(blendings: (number | undefined)[], transmissive: boolean[] = []) {
  return blendings.map((blending, index) => {
    const surface = G.basicSurface()
    Object.assign(surface, { blending })
    return { surface: surfaceOf(surface), transmissive: !!transmissive[index] }
  }) as unknown as BlendGpuItem[]
}

test('the declared modes are normal, then every mode a non-transmissive item names, in rank', () => {
  assert.deepEqual(declaredBlendModes([]), [], 'no transparent item, no blend program (#1362)')
  const all = items([...BLEND_MODES].reverse().map(hostBlending))
  assert.deepEqual(declaredBlendModes(all), BLEND_MODES)
  const glass = items([hostBlending('additive'), hostBlending('multiply')], [true, false])
  assert.deepEqual(declaredBlendModes(glass), ['normal', 'multiply'], 'transmission blends normal')
})

test('a precompiled mode is drawn without a compile; a mode a draw compiled first is kept', async () => {
  const built: string[] = []
  // A device that names how each pipeline was compiled: at once by a draw, or off the frame.
  const device = {
    createRenderPipeline: ({ label }: GPURenderPipelineDescriptor) => (
      built.push(`now:${label}`),
      { label, now: true }
    ),
    createRenderPipelineAsync: async ({ label }: GPURenderPipelineDescriptor) => (
      built.push(`async:${label}`),
      { label, now: false }
    ),
  } as unknown as GPUDevice
  const set = pipelinesByMode(device, (mode) => [{ label: mode } as GPURenderPipelineDescriptor])
  const now = (mode: Blending) => (set.at(mode, 0) as unknown as { now: boolean }).now
  const drawn = set.at('multiply', 0)
  await set.precompile(['normal', 'additive', 'multiply'])
  assert.deepEqual(built, ['now:multiply', 'async:normal', 'async:additive'])
  assert.equal(set.at('multiply', 0), drawn, 'the pipeline a draw already bound is not replaced')
  assert.equal(now('additive'), false)
  assert.equal(now('normal'), false)
  assert.equal(built.length, 3, 'no draw compiles a precompiled mode')
  await set.precompile(['additive'])
  assert.equal(built.length, 3, 'a compiled mode is never compiled again')
})

test('the fallback pass precompiles, off the frame, the very pipeline a draw would compile', async () => {
  const lazy = fakeDevice(),
    eager = fakeDevice()
  const drawnLazily = (await createWebgpuPagesPipelines(lazy.device, 256)).pipelineBlend
  const precompiled = (await createWebgpuPagesPipelines(eager.device, 256)).pipelineBlend
  const modes = declaredBlendModes(items(BLEND_MODES.map(hostBlending)))
  await precompiled.precompile(modes)
  const compiledAtPrepare = eager.renderPipelines.length
  // The fake's pipeline is its descriptor; each device builds its own module, so the descriptors
  // are compared as data.
  for (const mode of modes)
    assert.equal(
      JSON.stringify(precompiled.at(mode, 0)),
      JSON.stringify(drawnLazily.at(mode, 0)),
      mode,
    )
  assert.equal(eager.renderPipelines.length, compiledAtPrepare, 'no draw compiled a pipeline')
})
