// The distortion's never-waiting skip (`expansionFrame.ts`): an image draws it unless the verdict's
// counts, read back under the very same inputs, saw no transmissive item in view — and any input
// the verdict reads moving brings it back at once.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { surfaceOf } from '../../geometry/pages/surface.ts'
import { encodeBlendExpansion, noTransmissiveInView } from './expansionFrame.ts'
import { viewKey } from '../../frame/backend/state/viewKey.ts'
import type { ViewVerdict } from '../verdict/verdictRead.ts'
import { noteKeyRecord } from '../keyRecords.ts'

import { KEY_RECORD_WORDS } from '../keyLayout.ts'
import { orderBlendPasses } from '../order/order.ts'
import { blendSceneOf } from '../plan/plan.fixture.ts'
import type { BlendGpuItem } from '../state.ts'

/** The kind of view an image is for: the main image, a planar view, a face of the sky meshes' capture. */
type BlendViewKind = 'main' | 'planar' | 'face'
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
  const keys: number[] = [],
    reads: string[] = []
  // One verdict slot for each view, by the key of its gpu group, as the readback makes them.
  const slots = new Map<object, ViewVerdict>()
  const verdictOf = (key: object, cutWords = 0) => {
    let slot = slots.get(key)
    if (!slot)
      slots.set(
        key,
        (slot = {
          latest: { epoch: -1, rejected: 0, inView: 0 },
          judged: new Float64Array(24),
          cuts: new Uint32Array(cutWords),
          seen: -1,
          epoch: 0,
        } as unknown as ViewVerdict),
      )
    return slot
  }
  blendState.expand = {
    buffers: {},
    verdictOf,
    peekVerdict: (key: object) => slots.get(key),
    uploadPlan: () => {},
    uploadKeys: (first: number) => keys.push(first),
    uploadFrame: () => {},
    uploadCuts: () => {},
    uploadView: () => {},
    clearVerdict: () => {},
    judge: () => {},
    encode: () => {},
    readCounts: () => reads.push('read'),
  } as never
  blendState.itemBuffer = {} as GPUBuffer
  const runtimes = new Map<BlendViewKind, WebgpuPagesRuntime>()
  /** The runtime of a view kind: each kind has its own gpu group, hence its own key. */
  const runtimeOf = (view: BlendViewKind) => {
    let rt = runtimes.get(view)
    if (!rt) runtimes.set(view, (rt = { blendState, gpu: {}, run: {}, context: {} } as never))
    return rt
  }
  const encoder = { beginComputePass: () => ({ end: () => {} }) } as unknown as GPUCommandEncoder
  /** One image: whether it draws the distortion, or stays quiet. */
  const image = (view: BlendViewKind = 'main') => {
    orderBlendPasses(blendState, [0, 0, 5])
    const rt = runtimeOf(view)
    encodeBlendExpansion(rt, encoder, view === 'face')
    const quiet = noTransmissiveInView(blendState, rt.gpu)
    return { bound: !quiet, quiet }
  }
  /** The counts of the last image of `view` come back: `inView` water items in view. */
  const readBack = (inView: number, view: BlendViewKind = 'main') => {
    const slot = verdictOf(viewKey(runtimeOf(view).gpu))
    slot.latest.epoch = slot.epoch
    slot.latest.inView = inView
  }
  return { blendState, image, readBack, keys, reads }
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

test('a planar view reads its own counts: it draws while unread, is quiet when its own say none, and the main image’s do not answer for it', () => {
  const { image, readBack } = waterScene()
  image()
  readBack(0)
  assert.equal(image().quiet, true)
  assert.deepEqual(image('planar'), { bound: true, quiet: false }, 'unread: drawn')
  readBack(1, 'planar')
  assert.equal(image('planar').quiet, false, 'water in its view')
  readBack(0, 'planar')
  assert.deepEqual(image('planar'), { bound: false, quiet: true }, 'none in its own view')
  readBack(1)
  assert.equal(image().quiet, false, 'the main image has water in view')
  assert.equal(image('planar').quiet, true, 'the planar view keeps its own answer')
  assert.deepEqual(image('face'), { bound: true, quiet: false }, 'a face reads none')
})

test('another view judges its own planes: no view moves the epoch another’s counts come back under, and each reads back its own', () => {
  const { blendState, image, readBack, reads } = waterScene()
  image()
  image('planar')
  readBack(0)
  readBack(0, 'planar')
  assert.equal(reads.length, 2)
  const epoch = blendState.verdictEpoch
  blendState.blendPlanes[3] += 1
  assert.equal(image('planar').quiet, false, 'its planes moved')
  assert.equal(blendState.verdictEpoch, epoch, 'a view’s planes move no scene epoch')
  image('face')
  assert.equal(reads.length, 3, 'the face reads no counts back')
  blendState.blendPlanes[3] -= 1
  assert.equal(image().quiet, true, 'the main image judged the planes it still has')
})

test('a view whose sky cut moved since its last image judges anew: its counts come back under a new epoch', () => {
  const { blendState, image, readBack } = waterScene()
  const at = blendState.frameLayout.cuts
  blendState.cutWords = blendState.frameWords.subarray(at, at + 1)
  image()
  image('planar')
  readBack(0)
  readBack(0, 'planar')
  assert.equal(image().quiet, true)
  blendState.cutWords[0] = 1 << 1
  assert.equal(image().quiet, false, 'the main view’s cut moved: its counts are stale')
  readBack(0)
  assert.equal(image().quiet, true)
  assert.equal(image('planar').quiet, false, 'the planar view followed the cut at its own image')
})
