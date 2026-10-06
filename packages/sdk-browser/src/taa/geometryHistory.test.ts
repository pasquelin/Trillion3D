import test from 'node:test'
import assert from 'node:assert/strict'
import { upscaleRun, type UpscaleFrame } from './upscaleRun.fixture.ts'
import { taaJitter, taaStillFrames, upscalePhases } from './jitter.ts'

const image = (extra: Partial<UpscaleFrame> = {}): UpscaleFrame => ({
  render: [8, 8],
  display: [8, 8],
  moving: true,
  color: (x) => [x / 7, x / 7, x / 7, 1],
  depth: () => 0.4,
  id: () => 256,
  history: () => [0.5, 0.5, 0.5, 1],
  historyGeometry: () => [1, 0.4],
  ...extra,
})

test('another surface of the same placement revealing itself rejects the old depth', () => {
  for (const native of [false, true]) {
    const frame = image({ historyGeometry: () => [1, 0.8] })
    const fresh = upscaleRun({ ...frame, history: undefined }, false, false, native)(3, 3)
    const rejected = upscaleRun(frame, false, false, native)(3, 3).color
    rejected.forEach((value, i) => assert.ok(Math.abs(value - fresh.color[i]) < 1e-12))
    assert.notDeepEqual(upscaleRun(image(), false, false, native)(3, 3).color, fresh.color)
  }
})

// An uncovered pixel takes the current image whole, its history weighing nothing: it keeps none
// of it — colour, share target, flicker measure, reactive value, layers —, in every resolve. Its
// history is read beside the geometry that rejects it, both in flight at once, and dropped: a
// history of no number leaves no trace; the layers', read only once kept, are not read.
test('an uncovered pixel keeps none of its history', () => {
  const unread = () => {
    throw new Error('a history read')
  }
  const nothing = () => [NaN, NaN, NaN, NaN]
  for (const native of [false, true])
    for (const [asIs, filtered] of [
      [false, false],
      [true, true],
    ]) {
      const frame = image({
        historyGeometry: () => [2, 0.4],
        history: nothing,
        tags: nothing,
        moire: nothing,
        layerHistory: unread,
        reactive: () => NaN,
      })
      const { color, count } = upscaleRun(frame, asIs, filtered, native)(3, 3)
      assert.ok(color.every(Number.isFinite))
      assert.equal(count, 1 / 16, 'one sample: the current one')
    }
})

test('a full placement collision rejects history even with identical depths', () => {
  const frame = image({ placement: 255, historyGeometry: () => [1, 0.4] })
  const fresh = upscaleRun({ ...frame, history: undefined })(3, 3).color
  assert.deepEqual(upscaleRun(frame)(3, 3).color, fresh)
})

test('native and upscaled silhouettes carry the closest surface identity together', () => {
  for (const native of [false, true]) {
    const frame = image({
      display: native ? [8, 8] : [16, 16],
      depth: (x) => (x === 4 ? 0.8 : 0.2),
      id: (x) => (x === 4 ? 256 : 0),
    })
    assert.equal(upscaleRun(frame, false, false, native)(native ? 3 : 6, 3).tag, 1)
  }
})

test('a stationary lower-resolution image covers its full phase sequence before holding', () => {
  for (const scale of [1, 0.67, 0.5, 0.25]) {
    const phases = upscalePhases(Math.floor(1024 * scale), 1024)
    const renders = taaStillFrames(phases)
    const visited = new Set<string>()
    for (let rank = 0; rank < renders; rank++)
      visited.add([...taaJitter(rank, new Float64Array(2), phases)].join(','))
    assert.equal(visited.size, phases)
  }
})
