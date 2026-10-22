// The blending modes a scene declares are compiled off the frame, at prepare: the first draw in such a mode finds its pipeline and compiles nothing. What is compiled is
// what the draw would have compiled itself, descriptor for descriptor: the image cannot change.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../geometry/pages/surface.ts'
import { BLEND_MODES } from '../materials/surface/materialBlending.ts'
import { declaredBlendModes, pipelinesByMode } from './stagePipelines.ts'
import { graphProgramsOf } from './pipelines.ts'
import { material } from '../../../sdk-core/src/world/material/index.ts'
import type { MaterialGraph } from '../../../sdk-core/src/world/material/graph/api.ts'
import type { BlendGpuItem } from './state.ts'
import type { Blending } from '../../../sdk-core/src/world/constants/index.ts'

/** Blend items as prepare leaves them, one per blending mode. */
function items(blendings: Blending[], transmissive: boolean[] = []) {
  return blendings.map((blending, index) => {
    const surface = G.basicSurface()
    Object.assign(surface, { blending })
    return { surface: surfaceOf(surface), transmissive: !!transmissive[index] }
  }) as unknown as BlendGpuItem[]
}

test('the declared modes are normal, then every mode a non-transmissive item names, in rank', () => {
  assert.deepEqual(declaredBlendModes([]), [], 'no transparent item, no blend program')
  const all = items([...BLEND_MODES].reverse())
  assert.deepEqual(declaredBlendModes(all), BLEND_MODES)
  const glass = items(['additive', 'multiply'], [true, false])
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

test('the blend modules hold the programs of the graphs the translucent items wear, once each', () => {
  const wearing = (graph: MaterialGraph, transparent: boolean) => {
    const surface = G.basicSurface()
    Object.assign(surface, { transparent, graph })
    return { surface: surfaceOf(surface) }
  }
  const tinted = (r: number) => {
    const graph = material.graph('surface')
    graph.output('baseColor', graph.constant(r, 0, 0))
    return graph
  }
  const shared = tinted(1)
  // Two surfaces whose graphs compile alike are one program; a graph an opaque surface wears is
  // the resolve's, never the transparent pass's.
  const found = graphProgramsOf([
    wearing(shared, true),
    wearing(tinted(1), true),
    wearing(tinted(0.5), true),
    wearing(tinted(0.25), false),
    { surface: surfaceOf(G.basicSurface()) },
  ])
  assert.equal(found.length, 2)
  assert.ok(found.every((program) => program.kind === 'blend'))
  assert.deepEqual(
    found.map((program) => program.id),
    [...new Set(found.map((program) => program.id))].sort((a, b) => a - b),
  )
  assert.deepEqual(graphProgramsOf(items(['normal'])), [], 'a scene with no graph holds none')
})
