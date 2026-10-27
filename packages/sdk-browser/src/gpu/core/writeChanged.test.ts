// What `writeChanged` sends: only the words that changed, the buffer then holding the whole
// image; past the coalescer's cap the narrowest steps are joined, never the unused ids between a
// table's single-page and full maps' records.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { replayWrites } from '../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import {
  markWrittenOnGpu,
  writeChanged,
  writeChangedCopy,
  writeChangedRecords,
  writeChangedSlots,
} from './writeChanged.ts'
import { uniformSlots } from '../../session/memory/pools.ts'
import { WRITE_CAP } from '../../geometry/residency/ranges.ts'

/** A buffer copied from and into, written by the queue. */
const copies = () => GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST

test('only the changed words go up, the buffer holding the image; the hole is never sent', () => {
  const { device, writes } = fakeDevice()
  const words = 8192 * 4 + 64
  const buffer = device.createBuffer({
    label: 'next',
    size: words * 4,
    usage: GPUBufferUsage.COPY_DST,
  })
  const held = new Uint32Array(words)
  const image = new Uint32Array(words)
  // More records far apart below 8192 words than the cap holds writes, then one past the 8192-id
  // hole: the narrowest steps join, the widest — the hole — never.
  const far = WRITE_CAP + 16
  for (let k = 0; k < far; k++) image[k * 128] = k + 1
  image[8192 * 4 + 1] = 7
  writeChanged(device, buffer, image, 0, words)
  assert.ok(writes.length <= WRITE_CAP, `${writes.length} writes`)
  const sent = writes.reduce((sum, w) => sum + (w.size ?? 0), 0)
  assert.ok(sent < far * 128 + 64, `${sent} words sent, not the hole`)
  replayWrites(held.buffer, writes)
  assert.deepEqual(held, image)
  // A still image sends nothing; one word changed sends one word.
  writeChanged(device, buffer, image, 0, words)
  assert.equal(writes.length, 0)
  image[5] = 9
  writeChanged(device, buffer, image, 0, words)
  assert.deepEqual(
    writes.map((w) => [w.offset, w.size]),
    [[20, 1]],
  )
})

/** A buffer of 64 words written with threes, and the 128-word buffer it is copied into whole: the
 *  device, its writes, both buffers and the image of the source. */
function grownFrom() {
  const { device, writes } = fakeDevice()
  const source = device.createBuffer({ label: 'old', size: 64 * 4, usage: copies() })
  const target = device.createBuffer({ label: 'grown', size: 128 * 4, usage: copies() })
  const image = new Uint32Array(128)
  image.fill(3, 0, 64)
  writeChanged(device, source, image, 0, 64)
  return { device, writes, source, target, image }
}

test('a buffer copied from another holds its words: the next write sends what differs from them', () => {
  const { device, writes, source, target } = grownFrom()
  // The GPU copy: the target holds the source's words, then zeros.
  const gpu = new Uint32Array(128)
  gpu.fill(3, 0, 64)
  writeChangedCopy(source, target)
  writes.length = 0
  // A frame whose image puts zeros where the copy left threes: each goes up.
  const next = new Uint32Array(128)
  next.fill(3, 0, 32)
  next[100] = 5
  writeChanged(device, target, next, 0, 128)
  replayWrites(gpu.buffer, writes)
  assert.deepEqual(gpu, next)
})

test('a buffer a kernel wrote into is sent whole once, from its first word, then by diff again', () => {
  const { device, writes } = fakeDevice()
  const buffer = device.createBuffer({ label: 'edited', size: 64 * 4, usage: copies() })
  const image = new Uint32Array(64)
  image.fill(3, 0, 32)
  writeChanged(device, buffer, image, 0, 32)
  const gpu = new Uint32Array(64)
  replayWrites(gpu.buffer, writes)
  // The kernel adds to words the image still holds as they were: none differs from the words held,
  // yet each must go up. It wrote the first 16; the image's call reaches 8.
  for (let k = 0; k < 16; k++) gpu[k] += 100
  markWrittenOnGpu(buffer, 16)
  writeChanged(device, buffer, image, 0, 8)
  assert.deepEqual(
    writes.map((w) => [w.offset, w.size]),
    [[0, 16]],
    'the words the kernel may have written, whole',
  )
  replayWrites(gpu.buffer, writes)
  assert.deepEqual(gpu.slice(0, 32), image.slice(0, 32))
  // The mark is spent: a still image sends nothing, a changed word one word.
  writeChanged(device, buffer, image, 0, 32)
  assert.equal(writes.length, 0)
  image[20] = 9
  writeChanged(device, buffer, image, 0, 32)
  assert.deepEqual(
    writes.map((w) => [w.offset, w.size]),
    [[80, 1]],
  )
})

test('the writers by slots and by records refuse a buffer a kernel wrote into', () => {
  const { device } = fakeDevice()
  const buffer = device.createBuffer({ label: 'edited', size: 64 * 4, usage: copies() })
  const image = new Uint32Array(64)
  markWrittenOnGpu(buffer, 8)
  assert.throws(() => writeChangedRecords(device, buffer, image, [0], 1, 4), /written on the GPU/)
  const slots = { count: 2, words: 4, strideWords: 4 }
  assert.throws(() => writeChangedSlots(device, buffer, image, slots), /written on the GPU/)
})

test('a copy of a buffer a kernel wrote into carries the mark: its next write sends the words whole', () => {
  const { device, writes, source, target, image } = grownFrom()
  markWrittenOnGpu(source, 24)
  writeChangedCopy(source, target)
  writes.length = 0
  writeChanged(device, target, image, 0, 64)
  assert.deepEqual(
    writes.map((w) => [w.offset, w.size]),
    [[0, 64]],
  )
  writes.length = 0
  writeChanged(device, target, image, 0, 64)
  assert.equal(writes.length, 0)
})

test('a sparse table compared on the records it may have changed sends what a whole compare sends', () => {
  const whole = fakeDevice(),
    records = fakeDevice()
  const words = (8192 + 64) * 4
  const usage = GPUBufferUsage.COPY_DST,
    a = whole.device.createBuffer({ label: 'whole', size: words * 4, usage }),
    b = records.device.createBuffer({ label: 'records', size: words * 4, usage })
  const image = new Uint32Array(words),
    replayed = new Uint32Array(words),
    sent = new Uint32Array(words)
  let held: number[] = []
  // Frames that drop the last frame's records and take others, some kept from one to the next.
  for (const ids of [[3, 8192, 8200], [3, 8193, 8201, 8250], [8193], [5, 8250, 8255]]) {
    for (const id of held) image.fill(0, id * 4, id * 4 + 4)
    for (const id of ids) image.set([1, id, id + 1, id + 2], id * 4)
    const touched = [...new Set([...held, ...ids])].sort((x, y) => x - y)
    held = ids
    writeChanged(whole.device, a, image, 0, words)
    writeChangedRecords(records.device, b, image, touched, touched.length, 4)
    replayWrites(replayed.buffer, records.writes.splice(0))
    replayWrites(sent.buffer, whole.writes.splice(0))
    assert.deepEqual(replayed, image, 'the buffer holds the image')
    assert.deepEqual(replayed, sent, 'the same words as a whole compare sends')
  }
})

test('uniform slots go up by their words: as a whole compare at 256 bytes, never the padding past it', () => {
  // Eight slots of 32 words, at a 256-byte device (64 words) and a 1024-byte one (256 words).
  const frames = [
    [1, 2],
    [1, 3],
    [4, 3],
    [4, 3],
  ]
  const slotsOf = (stride: number, frame: number[]) => {
    const image = new Uint32Array(8 * stride)
    for (let s = 0; s < 8; s++) image.fill(frame[s % 2] + s, s * stride, s * stride + 32)
    return image
  }
  const whole = fakeDevice(),
    slots = fakeDevice(),
    wide = fakeDevice(),
    at1024 = { minUniformBufferOffsetAlignment: 1024 }
  const usage = GPUBufferUsage.COPY_DST,
    a = whole.device.createBuffer({ label: 'whole', size: 8 * 256, usage }),
    b = slots.device.createBuffer({ label: 'slots', size: 8 * 256, usage }),
    c = wide.device.createBuffer({ label: 'wide', size: 8 * 1024, usage })
  const held = new Uint32Array(8 * 256)
  for (const frame of frames) {
    const narrow = slotsOf(64, frame),
      image = slotsOf(256, frame)
    writeChanged(whole.device, a, narrow, 0, narrow.length)
    writeChangedSlots(slots.device, b, narrow, uniformSlots(undefined, 8, 32))
    writeChangedSlots(wide.device, c, image, uniformSlots(at1024, 8, 32))
    const shape = (w: typeof whole.writes) => w.map((x) => [x.offset, x.dataOffset, x.size])
    assert.deepEqual(shape(slots.writes.splice(0)), shape(whole.writes.splice(0)))
    for (const w of wide.writes)
      assert.ok(
        ((w.offset / 4) % 256) + w.size! <= 32,
        `a write reaches the padding at ${w.offset}`,
      )
    replayWrites(held.buffer, wide.writes)
    assert.deepEqual(held, image, 'the buffer holds the slots')
  }
})

test('slots a whole write once sent go up in one write at 256 bytes, the changed words alone', () => {
  // Develop wrote these slots whole, one write a call: one write at most, never longer than it.
  const { device, writes } = fakeDevice()
  const layout = uniformSlots(undefined, 6, 8)
  const buffer = device.createBuffer({
    label: 'one',
    size: layout.bytes,
    usage: GPUBufferUsage.COPY_DST,
  })
  const image = new Uint32Array(layout.bytes / 4),
    held = new Uint32Array(layout.bytes / 4)
  // Changes far apart within the range — the first slot's first word, the last slot's last —,
  // then a single word, then none.
  for (const words of [[0, 5 * 64 + 7], [2 * 64 + 4], []]) {
    for (const k of words) image[k]++
    writeChangedSlots(device, buffer, image, layout, 0, 6, 'one')
    assert.equal(writes.length, words.length ? 1 : 0)
    for (const w of writes) assert.ok(w.size! <= 6 * 64, 'never past the whole slots')
    if (words.length) assert.equal(writes[0].offset, words[0] * 4, 'from the first changed word')
    replayWrites(held.buffer, writes)
    assert.deepEqual(held, image)
  }
  // Slots [2, 4) alone: one write within them.
  image[3 * 64 + 1] = 9
  image[0] = 7
  writeChangedSlots(device, buffer, image, layout, 2, 4, 'one')
  assert.deepEqual(
    writes.map((w) => [w.offset, w.size]),
    [[(3 * 64 + 1) * 4, 1]],
  )
})
