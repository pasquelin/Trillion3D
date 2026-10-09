// A cut's tables past one binding split in parts bound at once: every section of `flags`
// stays whole in one part, so each list keeps one buffer and one offset, and
// a host write lands in the part that holds each of its bytes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { flagPartWords, writeParts } from './split.ts'
import { dagFlagsWords } from './shader/lastUseWgsl.ts'
import { LEVEL_QUEUES } from './shader/levelWgsl.ts'
import { flagCuts, flagSectionStart, splitTable } from './splitFlags.ts'
import { FLAG_SECTIONS } from './flagSections.ts'

test('a table splits in parts of as many whole elements as one binding holds', () => {
  assert.deepEqual(splitTable(10, 48, 4096), { per: 10, parts: 1 }, 'whole: one part')
  assert.deepEqual(splitTable(200, 48, 4096), { per: 85, parts: 3 })
  assert.deepEqual(splitTable(3, 96, 64), { per: 1, parts: 3 }, 'one element past: refused later')
})

test("the sections are the kernel's: queue 0, the lists and logs, the queues, the last use", () => {
  const shape = { queueWords: 14, candCap: 100, keyCount: 30 }
  assert.equal(FLAG_SECTIONS, 1 + 4 + LEVEL_QUEUES)
  assert.equal(flagSectionStart(1, shape), 14, 'the candidates, behind queue 0')
  assert.equal(flagSectionStart(2, shape), 14 + 2 * 100, 'the live list, behind them')
  assert.equal(flagSectionStart(3, shape), 14 + 5 * 100, 'the drawn log, behind it')
  assert.equal(flagSectionStart(4, shape), 14 + 6 * 100, 'the log being written, behind it')
  assert.equal(
    flagSectionStart(FLAG_SECTIONS - 1, shape),
    14 * LEVEL_QUEUES + 7 * 100,
    'the last use, behind the last queue (`lastUseAt`)',
  )
})

test('flags cut between whole sections, each part within the binding, all words kept', () => {
  const shape = { queueWords: 20, candCap: 300, keyCount: 700 },
    cap = 4096
  const cuts = flagCuts(shape, cap)
  const words = dagFlagsWords(shape.queueWords, shape.candCap, shape.keyCount)
  const parts = flagPartWords(cuts, shape, words)
  assert.deepEqual(cuts, [2, 3, 7])
  assert.ok(parts.every((part) => part * 4 <= cap))
  assert.equal(
    parts.reduce((a, b) => a + b),
    words,
  )
  assert.deepEqual(flagCuts(shape, words * 4), [], 'held whole: no cut')
})

test('a host write spanning two parts lands in each at its own offset', () => {
  const writes: [string, number, number, number][] = []
  const device = {
    queue: {
      writeBuffer: (b: { name: string }, at: number, _d: unknown, from: number, size: number) =>
        writes.push([b.name, at, from, size]),
    },
  } as unknown as GPUDevice
  const buffers = [{ name: 'a' }, { name: 'b' }] as unknown as GPUBuffer[]
  writeParts(device, { buffers, bytes: 64 }, 56, new ArrayBuffer(128), 56, 16)
  assert.deepEqual(writes, [
    ['a', 56, 56, 8],
    ['b', 0, 64, 8],
  ])
})
