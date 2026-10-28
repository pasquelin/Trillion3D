import { MAX_ANISOTROPY } from '../../texture/maxAnisotropy.ts'
import { previewLevelSize } from '../../../../../sdk-core/src/texture/previewLevels.ts'
// The tile pass stops copying once its millisecond budget is spent and defers the rest to the
// next pass, most looked-at first; a barrier lifts the budget; the worst budgeted pass is kept.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuTileStreamer } from './streamer.ts'
import { createFrameBudget } from '../../../geometry/integration/frameBudget.ts'
import { poolEncoding } from '../../texture/blockFormats.ts'
import { tileLayout } from '../../texture/tiles.ts'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createPageCache } from '../../../geometry/streaming/pageCache.ts'
import { tileLevelBytes, type TextureLevelRequest } from '../../texture/levelReader.ts'

/** The filtering the streamer is opened with: one object, as the session's getter keeps it. */
const FILTERING = { ceiling: MAX_ANISOTROPY, taps: true }
import { tileRecord } from '../../texture/tileRecords.ts'

/** Milliseconds each fake copy costs on the test's own clock — the budget is read on it — and
 *  what the follow of the landed colour tiles costs after the last copy. */
const COPY_MS = 2,
  FOLLOW_MS = 1

/** The device of the pass: each tile written costs `COPY_MS` on the test's clock — the writes
 *  before `start`, the fills' and the tails', count nothing —, and each colour signal `FOLLOW_MS`
 *  after it; a readback buffer gives back what the test wrote in it. */
function tileDevice() {
  const { device, buffers, textureWrites } = fakeDevice()
  let follows = 0,
    before = 0
  const copies = () => textureWrites.length - before
  return {
    device,
    staging: buffers,
    copies,
    start: () => void (before = textureWrites.length),
    now: () => copies() * COPY_MS + follows * FOLLOW_MS,
    follow: () => void follows++,
  }
}

/** One baked 256² colour texture: four level-0 tiles and one level-1 tile to stream. */
function streamer(budgetMs: number) {
  const { device, staging, copies, start, now, follow } = tileDevice()
  const layout = tileLayout(256, 256)
  const tail: Uint8Array<ArrayBuffer>[] = []
  for (let level = layout.tail; level <= layout.last; level++) {
    const [w, h] = previewLevelSize(256, 256, level)
    tail.push(new Uint8Array(w * h * 4))
  }
  const blocks = { bc7: [], astc: [], etc2: [] }
  const layouts = { bc7: 'rgba', astc: 'lossless', etc2: 'lossless' } as const
  const fill = {
    layout: tileLayout(1, 1),
    lane: 'lossless' as const,
    tap: 0,
    source: { kind: 'bytes' as const, tail: { levels: [new Uint8Array(4)], blocks } },
  }
  const sha256 = 'a'.repeat(64)
  const read = Object.assign(
    async ({ level, tx, ty }: TextureLevelRequest) => {
      const [width, height] = previewLevelSize(256, 256, level)
      return new Uint8Array(
        tileLevelBytes(tileRecord(width, height, tx, ty).bytes, { format: 'bc7', rgba: true }),
      )
    },
    { store: createPageCache(), key: 'k' },
  )
  const lossless = { lossless: 1, rgba: 0, 'two-channel': 0, hdr: 0 }
  const textures = createWebgpuTileStreamer({
    device,
    color: [
      fill,
      {
        layout,
        lane: 'lossless',
        tap: 0,
        source: {
          kind: 'baked',
          sha256,
          atlas: 0,
          tail: { levels: tail, blocks, layouts, atlas: 0 },
          read,
        },
      },
    ],
    data: [fill],
    layers: { color: lossless, data: lossless },
    encoding: poolEncoding(undefined),
    budgetBytes: Number.MAX_SAFE_INTEGER,
    budgetMs,
    clock: createFrameBudget(Infinity, { now }),
    onFailure: (phase, error) => assert.fail(`${phase}: ${String(error)}`),
    filtering: () => FILTERING,
    onColorChanged: follow,
  })
  textures.prepare()
  start()
  /** Image feedback that names every streamed tile, heaviest first: the next pass takes it. */
  const feed = async () => {
    textures.feedback.encode(device.createCommandEncoder())
    const readback = staging.filter((b) =>
      b.label?.startsWith('Trillion3D texture feedback readback'),
    )
    for (const buffer of readback)
      new Uint32Array(buffer.getMappedRange()).set([5, 4, 3, 2, 1].slice(0, layout.entries))
    textures.feedback.submitted()
    await textures.settled()
  }
  return { textures, feed, copies }
}

test('a pass copies until its millisecond budget is spent, then defers the rest to the next passes', async () => {
  const { textures, feed, copies } = streamer(1.5 * COPY_MS)
  assert.equal(textures.metrics().textureUploadPeakMs, null, 'no pass yet: unmeasured')
  await feed()
  // First pass: the levels are not decoded yet, nothing is copied, the reads are launched.
  assert.deepEqual(textures.pump(1), { served: 0, pending: 5 })
  await textures.settled()
  await feed()
  // One copy fits under the budget, the second closes it: two served, three deferred.
  assert.deepEqual(textures.pump(2), { served: 2, pending: 3 })
  assert.equal(copies(), 2)
  const metrics = textures.metrics()
  assert.equal(metrics.textureTilesDeferred, 3)
  assert.equal(metrics.textureTilesPending, 3)
  assert.equal(
    metrics.textureUploadPeakMs,
    2 * COPY_MS + FOLLOW_MS,
    'the peak is the pass that was measured, the follow of the landed tiles included',
  )
  assert.equal(metrics.textureUploadMs, 2 * COPY_MS + FOLLOW_MS)
  // No fresh feedback: the deferred tiles are served from the backlog, budget after budget.
  assert.deepEqual(textures.pump(3), { served: 2, pending: 1 })
  assert.deepEqual(textures.pump(4), { served: 1, pending: 0 })
  assert.equal(textures.metrics().textureTilesDeferred, 0)
  assert.equal(copies(), 5)
  // Nothing named, nothing deferred: the pass does no work and costs nothing measurable.
  assert.deepEqual(textures.pump(5), { served: 0, pending: 0 })
  assert.equal(textures.counters.worked, false)
  assert.equal(textures.metrics().textureUploadMs, null)
})

test('a zero budget still lands one tile per pass, and a barrier lifts the budget without moving the peak', async () => {
  const { textures, feed, copies } = streamer(0)
  await feed()
  textures.pump(1)
  await textures.settled()
  await feed()
  assert.deepEqual(textures.pump(2), { served: 1, pending: 4 })
  const peak = textures.metrics().textureUploadPeakMs
  assert.deepEqual(textures.pump(3, true), { served: 4, pending: 0 })
  assert.equal(copies(), 5)
  assert.equal(textures.metrics().textureUploadPeakMs, peak, 'an unbounded pass is not a frame')
  assert.equal(textures.metrics().textureUploadMs, null, 'nor is it a last pass')
})
