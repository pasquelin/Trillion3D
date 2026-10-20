import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { planPipeline } from './plan.ts'
import { planVertexCull } from './expandCpu.fixture.ts'
import { blendSceneOf } from './plan.fixture.ts'
import type { Blending } from '../../../../sdk-core/src/world/constants/index.ts'
import type { BlendGpuItem } from './state.ts'
import { surfaceOf, type PageSurface } from '../../page/surface.ts'
import { TRANSMIT_BASE, planCull } from './planCull.ts'

/** The blend plan of a lone item, everything but its material left at its simplest. */
function plan(material: PageSurface | PageSurface[], { transmissive = false } = {}) {
  const blendState = blendSceneOf([
    {
      transmissive,
      surface: surfaceOf(material),
      matrix: new Matrix4(),
    } as unknown as BlendGpuItem,
  ])
  return [...blendState.seeds]
}

test('an item that declares no material plans the host default side: one front entry, not a crash', () => {
  const front = plan(G.basicSurface({ side: G.FRONT_SIDE }))
  assert.equal(front.length, 1)
  assert.deepEqual(plan([]), front, 'an empty material array declares nothing: front')
})

// An entry picks the pipelines of its item's mode — three culls per mode, normal first.
test('an item plans on the pipelines of its blend mode; a mode no path draws is refused', () => {
  const pipelineOf = (blending: Blending | undefined, transmissive = false) =>
    plan(Object.assign(G.basicSurface({ transparent: true }), { blending }), { transmissive }).map(
      planPipeline,
    )
  const normal = pipelineOf('normal')
  assert.deepEqual(
    pipelineOf('additive'),
    normal.map((p) => p + 3),
  )
  assert.deepEqual(
    pipelineOf('multiply'),
    normal.map((p) => p + 9),
  )
  assert.deepEqual(
    pipelineOf('none'),
    normal.map((p) => p + 12),
  )
  assert.deepEqual(
    pipelineOf('normal', true),
    normal.map((p) => p + TRANSMIT_BASE),
  )
  assert.throws(() => pipelineOf(undefined), /blending no path draws/)
  assert.throws(() => pipelineOf('additive', true), /cannot use additive/)
})

test('a double-sided item plans back then face on the pipeline that culls nothing', () => {
  const entries = plan(G.basicSurface({ side: G.DOUBLE_SIDE }))
  // Back first: the pass culls the face (1), then the back (2); the vertex stage applies both.
  assert.deepEqual(entries.map(planCull), [1, 2])
  assert.deepEqual(entries.map(planPipeline), [0, 0])
  assert.deepEqual(entries.map(planVertexCull), [1, 2])
})

test('a double-sided transmissive item plans back then face as a blend does, on its own pipelines', () => {
  const entries = plan(G.basicSurface({ side: G.DOUBLE_SIDE }), { transmissive: true })
  assert.deepEqual(entries.map(planCull), [1, 2])
  assert.deepEqual(entries.map(planPipeline), [TRANSMIT_BASE, TRANSMIT_BASE])
  assert.deepEqual(entries.map(planVertexCull), [1, 2])
})

test("a double-sided item of another mode sets that mode's pipeline that culls nothing", () => {
  const entries = plan(
    G.basicSurface({ side: G.DOUBLE_SIDE, transparent: true, blending: 'additive' }),
  )
  assert.deepEqual(entries.map(planCull), [1, 2])
  assert.deepEqual(entries.map(planPipeline), [3, 3])
  assert.deepEqual(entries.map(planVertexCull), [1, 2])
})
