// A frame whose scene moved writes the transparent records' poses alone while no material moved
// (`refreshBlendScene`): the sixteen words of each item whose matrix moved, sent as one span, every
// other word as it was; nothing when no pose moved; a material written since, every record whole.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { blendSceneOf } from './plan.fixture.ts'
import { BLEND_ITEM_WORDS } from './items.ts'
import { refreshBlendScene } from './resources.ts'
import { refreshWebgpuMaterials } from '../pages/io/refreshMaterials.ts'
import type { BlendGpuItem } from './state.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

const RECORD = BLEND_ITEM_WORDS * 4

/** Four unpaged items in a row, their records allocated as `prepareBlendResources` does, and the
 *  spans the queue is sent. */
function scene() {
  const matrices = [0, 1, 2, 3].map((i) => new G.Matrix4().makeTranslation(i, 0, 0))
  const items = matrices.map(
    (matrix, i) =>
      ({
        surface: surfaceOf(G.basicSurface({ transparent: true })),
        count: 3,
        flags: 1,
        matrix,
        sourceGeometry: new G.Geometry(),
        bounds: new Float64Array([i, 0, 0, i + 1, 1, 1]),
      }) as unknown as BlendGpuItem,
  )
  const blendState = blendSceneOf(items)
  blendState.itemPacked = new Float32Array(items.length * BLEND_ITEM_WORDS)
  blendState.itemInts = new Uint32Array(blendState.itemPacked.buffer)
  blendState.itemBuffer = {} as GPUBuffer
  const writes: { offset: number; size: number }[] = []
  const queue = {
    writeBuffer: (_: GPUBuffer, offset: number, _data: unknown, _at: number, size: number) =>
      void writes.push({ offset, size }),
  }
  const rt = {
    blendState,
    vis: { mapLayer: new Map(), dataLayer: new Map() },
    gpu: {},
    layout: { rows: { tableEpoch: 0 } },
    run: { gate: { sceneMoved() {} } },
  } as unknown as WebgpuPagesRuntime
  return { matrices, items, blendState, writes, device: { queue } as unknown as GPUDevice, rt }
}

test('a moved pose sends its sixteen words alone, a moved material every record', () => {
  const { matrices, items, blendState, writes, device, rt } = scene()
  refreshBlendScene(rt, device)
  assert.deepEqual(writes, [{ offset: 0, size: items.length * RECORD }])
  const whole = blendState.itemPacked.slice()
  writes.length = 0
  refreshBlendScene(rt, device, true)
  assert.deepEqual(writes, [], 'no pose moved: nothing is sent')
  matrices[1].makeTranslation(5, 1, 0)
  matrices[2].makeTranslation(7, 0, 2)
  refreshBlendScene(rt, device, true)
  assert.deepEqual(writes, [{ offset: RECORD, size: 2 * RECORD }])
  for (let i = 0; i < items.length; i++) {
    const record = blendState.itemPacked.subarray(i * BLEND_ITEM_WORDS, (i + 1) * BLEND_ITEM_WORDS)
    const pose = Array.from(matrices[i].elements, (x) => Math.fround(x))
    assert.deepEqual(Array.from(record.subarray(0, 16)), pose)
    assert.deepEqual(
      Array.from(record.subarray(16)),
      Array.from(whole.subarray(i * BLEND_ITEM_WORDS + 16, (i + 1) * BLEND_ITEM_WORDS)),
      `item ${i}: the rest of its record as it was`,
    )
  }
  writes.length = 0
  refreshWebgpuMaterials(rt, true)
  refreshBlendScene(rt, device, true)
  assert.deepEqual(writes, [{ offset: 0, size: items.length * RECORD }])
})
