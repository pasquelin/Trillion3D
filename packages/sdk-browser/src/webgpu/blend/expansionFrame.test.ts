// The water pass's never-waiting skip (`expansionFrame.ts`): an image that wants water binds its
// rectangle's kernels unless the verdict's counts, read back under the very same inputs, saw no
// transmissive item in view — and any input the verdict reads moving brings the pass back at once.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { surfaceOf } from '../../page/surface.ts'
import { encodeBlendExpansion } from './expansionFrame.ts'
import { noteKeyRecord } from './keyRecords.ts'
import { orderBlendPasses } from './order.ts'
import { blendSceneOf } from './plan.fixture.ts'
import { WATER_RANK_SHIFT } from '../water/rank.ts'
import type { BlendGpuItem } from './state.ts'
import type { WebgpuPagesRuntime } from '../pages/runtime.ts'

/** A scene of one blend and one water item, its kernels stood in by a recorder. */
function waterScene() {
  const item = (water: number) =>
    ({
      surface: surfaceOf(G.basicSurface({ transparent: true })),
      matrix: new G.Matrix4(),
      count: 3,
      transmissive: water > 0,
      flags: water << WATER_RANK_SHIFT,
      bounds: new Float64Array([-1, -1, -1, 1, 1, 1]),
    }) as unknown as BlendGpuItem
  const blendState = blendSceneOf([item(0), item(1)])
  blendState.transmissive = 1
  const bound: number[] = [],
    keys: number[] = []
  const counts = { epoch: -1, rejected: 0, inView: 0 }
  blendState.expand = {
    buffers: {},
    counts,
    uploadPlan: () => {},
    uploadKeys: (first: number) => keys.push(first),
    uploadFrame: () => {},
    clearVerdict: () => {},
    judge: () => {},
    encode: () => {},
    readCounts: () => {},
  } as never
  blendState.water = { rect: { encode: () => bound.push(1) } } as never
  blendState.itemBuffer = {} as GPUBuffer
  const rt = { blendState, gpu: { volumeBuffer: {} } } as unknown as WebgpuPagesRuntime
  const encoder = { beginComputePass: () => ({ end: () => {} }) } as unknown as GPUCommandEncoder
  /** One image that wants water: whether its rectangle's kernels ran, or it stayed quiet. */
  const image = () => {
    bound.length = 0
    orderBlendPasses(blendState, [0, 0, 5])
    blendState.waterWanted = true
    encodeBlendExpansion(rt, encoder)
    return { bound: bound.length === 1, quiet: blendState.waterQuiet }
  }
  /** The counts of the last image come back: `inView` water items in view. */
  const readBack = (inView: number) => {
    counts.epoch = blendState.verdictEpoch
    counts.inView = inView
  }
  return { blendState, image, readBack, keys }
}

test('no count back yet: the pass is bound, and the GPU gates it', () => {
  const { image } = waterScene()
  assert.deepEqual(image(), { bound: true, quiet: false })
})

test('counts under the same inputs with no water in view: nothing is encoded, nothing waited for', () => {
  const { image, readBack } = waterScene()
  image()
  readBack(0)
  assert.deepEqual(image(), { bound: false, quiet: true })
  assert.deepEqual(image(), { bound: false, quiet: true }, 'a still view stays quiet')
  readBack(1)
  assert.deepEqual(image(), { bound: true, quiet: false }, 'water in view draws')
})

test('a plane, a box or a drawn bit moved since the counts: the pass comes back at once', () => {
  const { blendState, image, readBack, keys } = waterScene()
  image()
  readBack(0)
  assert.equal(image().quiet, true)
  blendState.blendPlanes[3] += 1
  assert.deepEqual(image(), { bound: true, quiet: false }, 'the frustum moved')
  readBack(0)
  assert.equal(image().quiet, true)
  noteKeyRecord(blendState, 1)
  assert.deepEqual(image(), { bound: true, quiet: false }, 'a key record went up')
  assert.deepEqual(keys, [16], 'the water item’s record alone')
  readBack(0)
  blendState.planMoved = true
  assert.deepEqual(image(), { bound: true, quiet: false }, 'a new plan')
})
