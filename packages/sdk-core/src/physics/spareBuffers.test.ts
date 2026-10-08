import test from 'node:test'
import assert from 'node:assert/strict'
import { CommandWriter } from './commands.ts'
import { SpareBuffers } from './spareBuffers.ts'
import { lcgImulWord } from '../../../math/src/sequence/seeded.fixture.ts'

/** NaN, -NaN, ±0, ±Inf and the largest finite float, as a frame's command words can carry. */
const EDGES = [0x7fc00000, 0xffc00001, 0, 0x80000000, 0x7f800000, 0xff800000, 0x7f7fffff]

test('a take carries the words develop copied out, in a buffer handed back when one holds them', () => {
  const next = lcgImulWord(7)
  const writer = new CommandWriter()
  const inFlight: ArrayBuffer[] = []
  const seen = new Set<ArrayBuffer>()
  // Frames of 0 to 3000 words: empty, growing past the writer's first size, and shrinking.
  for (let frame = 0; frame < 200; frame++) {
    const size = frame % 17 === 0 ? 0 : Math.floor((next() / 2 ** 32) * 3000)
    const words = Array.from({ length: size }, (_, i) =>
      i % 5 === 0 ? EDGES[i % EDGES.length] : next(),
    )
    writer.put(words, [])
    const out = writer.take()
    assert.deepEqual([...out], words, `frame ${frame}`)
    assert.equal(writer.length, 0)
    seen.add(out.buffer)
    // The worker hands a frame's buffer back one frame later, as the results of its tick do.
    inFlight.push(out.buffer)
    if (inFlight.length > 1) writer.recycle(inFlight.splice(0, 1))
  }
  assert.ok(seen.size < 12, `${seen.size} buffers allocated over 200 frames`)
})

test('spare buffers are reused past their first size and dropped past their bound', () => {
  const spare = new SpareBuffers()
  const words = new Uint32Array(5000).map((_, i) => i)
  const a = spare.copy(words, 3)
  assert.deepEqual([...a], [0, 1, 2])
  assert.equal(a.buffer.byteLength, 4096, 'at least 1024 words')
  spare.recycle([a.buffer])
  const b = spare.copy(words, 1000)
  assert.equal(b.buffer, a.buffer, 'the spare that holds them')
  const c = spare.copy(words, 5000)
  assert.equal(c.buffer.byteLength, 32768, 'a new buffer, a power of two')
  assert.deepEqual([...c], [...words])
  spare.recycle([b.buffer, c.buffer])
  assert.equal(spare.copy(words, 2000).buffer, c.buffer, 'none too small is taken')
  const many = Array.from({ length: 6 }, () => new ArrayBuffer(4096))
  spare.recycle(many)
  const kept = Array.from({ length: 6 }, () => spare.copy(words, 1).buffer)
  assert.equal(
    kept.filter((buffer) => buffer.byteLength === 4096 && many.includes(buffer)).length,
    3,
  )
  assert.equal(spare.copy(words, 0).length, 0, 'an empty take')
})
