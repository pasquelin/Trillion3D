// The distortion's never-waiting skip (`expansionFrame.ts`): an image draws it unless the verdict's
// counts, read back under the very same inputs, saw no transmissive item in view — and any input
// the verdict reads moving brings it back at once.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { encodeBlendExpansion, noTransmissiveInView } from './expansionFrame.ts'
import { noteKeyRecord } from '../keyRecords.ts'
import { KEY_RECORD_WORDS } from '../keyLayout.ts'
import { orderBlendPasses } from '../order/order.ts'
import { blendSceneOf } from '../plan/plan.fixture.ts'
import type { BlendGpuItem } from '../state.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'

/** A scene of one blend and one transmissive item, its kernels stood in by a recorder. */
function waterScene() {
  const item = (water: number) =>
    ({
      surface: surfaceOf(G.basicSurface({ transparent: true })),
      geometry: { quantized: false },
      matrix: new Matrix4(),
      count: 3,
      transmissive: water > 0,
      flags: 0,
      bounds: new Float64Array([-1, -1, -1, 1, 1, 1]),
    }) as unknown as BlendGpuItem
  const blendState = blendSceneOf([item(0), item(1)])
  blendState.transmissive = 1
  const keys: number[] = []
  const counts = { epoch: -1, rejected: 0, inView: 0 }
  blendState.expand = {
    buffers: {},
    counts,
    uploadPlan: () => {},
    uploadKeys: (first: number) => keys.push(first),
    uploadFrame: () => {},
    uploadView: () => {},
    clearVerdict: () => {},
    judge: () => {},
    encode: () => {},
    readCounts: () => {},
  } as never
  blendState.itemBuffer = {} as GPUBuffer
  const rt = { blendState, gpu: {}, run: {}, context: {} } as unknown as WebgpuPagesRuntime
  const encoder = { beginComputePass: () => ({ end: () => {} }) } as unknown as GPUCommandEncoder
  /** One image: whether it draws the distortion, or stays quiet. */
  const image = () => {
    orderBlendPasses(blendState, [0, 0, 5])
    encodeBlendExpansion(rt, encoder)
    const quiet = noTransmissiveInView(blendState)
    return { bound: !quiet, quiet }
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
  assert.deepEqual(keys, [KEY_RECORD_WORDS], 'the water item’s record alone')
  readBack(0)
  blendState.planMoved = true
  assert.deepEqual(image(), { bound: true, quiet: false }, 'a new plan')
})
