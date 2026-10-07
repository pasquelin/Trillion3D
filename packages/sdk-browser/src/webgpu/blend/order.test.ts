import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import type { PlacementOf } from '../../placement/rows.ts'
import { buildBlendStatics, refreshBlendPlan } from './plan.ts'
import { orderBlendPasses } from './order.ts'
import { blendSceneOf, paintOutcome } from './plan.fixture.ts'
import { createWebgpuBlendState, type BlendGpuItem } from './state.ts'

type BlendState = ReturnType<typeof createWebgpuBlendState>

/** A paged double-sided item whose box is centred on `z`, the one input its rank reads. */
function item(z: number, extra: Partial<BlendGpuItem> = {}) {
  return {
    surface: surfaceOf(G.basicSurface({ side: 2 })),
    matrix: new G.Matrix4(),
    count: 3,
    paged: true,
    bounds: new Float64Array([-1, -1, z - 1, 1, 1, z + 1]),
    ...extra,
  } as unknown as BlendGpuItem
}

/** Everything a ranking hands the frame: paint order, slots, mask, reject and water counts. */
function outcome(blendState: BlendState, rejected: number) {
  return {
    rejected,
    ...paintOutcome(blendState),
    keep: Array.from(blendState.keepPacked),
    transmissiveInView: blendState.transmissiveInView,
  }
}

/** Ranks `blendState` and a fresh scene of the same items and planes, from source order. */
function rankAgainstFresh(blendState: BlendState, eye: number[]) {
  const kept = outcome(blendState, orderBlendPasses(blendState, eye))
  const fresh = blendSceneOf([...blendState.blendGpu])
  fresh.blendPlanes.set(blendState.blendPlanes)
  assert.deepEqual(
    kept,
    outcome(fresh, orderBlendPasses(fresh, eye)),
    'bit-identical to a full ranking',
  )
}

/** A scene already ranked from the eye. */
function rankedScene(items = [item(-4), item(-8), item(-2), item(-6)]) {
  const blendState = blendSceneOf(items)
  // Rejects every box beyond z = 3: none of the four, but a moved one can be.
  blendState.blendPlanes.set([0, 0, -1, 3])
  const eye = [0, 0, 0]
  orderBlendPasses(blendState, eye)
  return { blendState, eye }
}

test('a still frame after a move keeps the order of a full ranking', () => {
  const blendState = blendSceneOf([item(-4), item(-8)])
  orderBlendPasses(blendState, [0, 0, 0])
  orderBlendPasses(blendState, [0, 0, -9])
  rankAgainstFresh(blendState, [0, 0, -9])
})

const changes: [string, (scene: ReturnType<typeof rankedScene>) => void][] = [
  ['the eye moves', (scene) => (scene.eye = [0, 0, -9])],
  ['a frustum plane moves', ({ blendState }) => blendState.blendPlanes.set([0, 0, -1, 5])],
  [
    'a box moves in place',
    ({ blendState }) => blendState.blendGpu[0].bounds!.set([-1, -1, 4, 1, 1, 6]),
  ],
  ['a box is dropped', ({ blendState }) => (blendState.blendGpu[1].bounds = undefined)],
  [
    'a row is parked',
    ({ blendState }) => ((blendState.blendGpu[2].placement as PlacementOf).rows.live[0] = 0),
  ],
  ['its node is hidden', ({ blendState }) => (blendState.blendGpu[1].hidden = true)],
  ['the plan is rebuilt', ({ blendState }) => refreshBlendPlan(blendState)],
  [
    'an item joins',
    ({ blendState }) => {
      blendState.blendGpu.push(item(-3))
      buildBlendStatics(blendState, blendState.uniformStride)
      refreshBlendPlan(blendState)
    },
  ],
]

for (const [what, change] of changes)
  test(`${what}: the frame matches a full ranking`, () => {
    const row = { rows: { live: new Uint8Array([1]) }, index: 0 } as unknown as PlacementOf
    const scene = rankedScene([item(-4), item(-8), item(-2, { placement: row }), item(-6)])
    change(scene)
    rankAgainstFresh(scene.blendState, scene.eye)
  })

test('an item without a box follows its world origin, as a full ranking would', () => {
  const { blendState, eye } = rankedScene([item(-4), item(-8, { bounds: undefined })])
  ;(blendState.blendGpu[1].matrix.elements as number[])[14] = -1
  rankAgainstFresh(blendState, eye)
})

test('an item that turns transmissive: the water count follows', () => {
  const { blendState, eye } = rankedScene()
  blendState.blendGpu[0].transmissive = true
  orderBlendPasses(blendState, eye)
  assert.equal(blendState.transmissiveInView, 1)
})

test('a frame without an eye resumes ranking when the eye returns', () => {
  const { blendState, eye } = rankedScene()
  orderBlendPasses(blendState, undefined)
  rankAgainstFresh(blendState, eye)
})

test('a frame without an eye draws no slot, the next frame with one draws them all again', () => {
  const { blendState, eye } = rankedScene()
  const slots = [...blendState.runCount]
  orderBlendPasses(blendState, undefined)
  assert.deepEqual(blendState.runCount, [0, 0], 'no paint order, nothing drawn')
  orderBlendPasses(blendState, eye)
  assert.deepEqual(blendState.runCount, slots, 'the transparents are drawn again')
})
