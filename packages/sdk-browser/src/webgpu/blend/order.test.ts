import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import type { PlacementOf } from '../../placement/rows.ts'
import { buildBlendStatics, refreshBlendPlan } from './plan.ts'
import { orderBlendPasses } from './order.ts'
import { blendSceneOf, paintOutcome } from './plan.fixture.ts'
import { type BlendGpuItem, type WebgpuBlendState } from './state.ts'

/** A paged double-sided item whose box is centred on `z`, the one input its rank reads. */
function item(z: number, extra: Partial<BlendGpuItem> = {}) {
  return {
    surface: surfaceOf(G.basicSurface({ side: G.DOUBLE_SIDE })),
    matrix: new G.Matrix4(),
    count: 3,
    paged: true,
    bounds: new Float64Array([-1, -1, z - 1, 1, 1, z + 1]),
    ...extra,
  } as unknown as BlendGpuItem
}

/** Ranks `blendState` and a fresh scene of the same items and planes, from source order: the
 *  paint order, the slots and the frame words (the head's planes and item count included). */
function rankAgainstFresh(blendState: WebgpuBlendState, eye: number[]) {
  orderBlendPasses(blendState, eye)
  const kept = paintOutcome(blendState)
  const fresh = blendSceneOf([...blendState.blendGpu])
  fresh.blendPlanes.set(blendState.blendPlanes)
  orderBlendPasses(fresh, eye)
  assert.deepEqual(kept, paintOutcome(fresh), 'bit-identical to a full ranking')
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

test('the CPU reads no box of an item the GPU keys and judges: the verdict is the GPU’s', () => {
  const { blendState, eye } = rankedScene()
  // Every item is paged and of the main class: the GPU keys it, judges it, orders it.
  const items = blendState.blendGpu
  items.forEach((item, rank) => {
    items[rank] = new Proxy(item, {
      get: (target, key) =>
        key === 'bounds'
          ? assert.fail(`item ${rank}'s box read on the CPU`)
          : Reflect.get(target, key),
    })
  })
  orderBlendPasses(blendState, eye)
  orderBlendPasses(blendState, [0, 0, -9])
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
