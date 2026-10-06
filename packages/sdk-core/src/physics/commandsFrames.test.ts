import test from 'node:test'
import assert from 'node:assert/strict'
import { CommandWriter } from './commands.ts'
import { body, read } from './commands.fixture.ts'
import { OP } from './layout.ts'

test('put carries whole words (negatives as their unsigned word), then floats, then bytes', () => {
  const writer = new CommandWriter()
  writer.put([-1, 3], [0.5, -2], new Uint8Array([23]))
  const { words, floats } = read(writer.take())
  assert.deepEqual([...words.subarray(0, 2)], [0xffffffff, 3])
  assert.deepEqual([...floats.subarray(2, 4)], [0.5, -2])
  assert.deepEqual([...new Uint8Array(words.buffer, 16, 4)], [23, 0, 0, 0])
  assert.equal(words.length, 5)
})

test('a frame grows past the first buffer whole, a command across the boundary included', () => {
  const fill = 1022
  for (const write of [
    (w: CommandWriter) => w.teleport(4, [1, 2, 3], [0, 0, 0, 1]),
    (w: CommandWriter) => w.view([1, 2, 3], [4, 5, 6], 0.5, 300),
    (w: CommandWriter) => w.put([7], [], new Uint8Array(17).fill(29)),
    (w: CommandWriter) => w.add(body),
  ]) {
    const writer = new CommandWriter(),
      alone = new CommandWriter()
    writer.put(new Uint32Array(fill).fill(123), [])
    write(writer)
    write(alone)
    const { words } = read(writer.take())
    assert.ok(words.subarray(0, fill).every((value) => value === 123))
    assert.deepEqual([...words.subarray(fill)], [...alone.take()])
  }
  const writer = new CommandWriter()
  for (let i = 0; i < 1100; i++) writer.impulse(i, [i, -i, 0.5])
  const expected = new Uint32Array(1100 * 5),
    numbers = new Float32Array(expected.buffer)
  for (let i = 0; i < 1100; i++) {
    expected.set([OP.impulse, i], i * 5)
    numbers.set([i, -i, 0.5], i * 5 + 2)
  }
  assert.deepEqual(writer.take(), expected)
})

test('a taken frame is its own: later frames, through recycled buffers, never write over it', () => {
  for (const reverse of [false, true]) {
    const writer = new CommandWriter()
    writer.put(new Uint32Array(1024).fill(7), [])
    const first = writer.take()
    writer.put(new Uint32Array(2048).fill(8), [])
    const second = writer.take()
    const kept = second.slice()
    writer.recycle(reverse ? [second.buffer, first.buffer] : [first.buffer, second.buffer])
    writer.put(new Uint32Array(2048).fill(9), [])
    assert.equal(writer.take().buffer, second.buffer, 'the one that holds it')
    writer.put(new Uint32Array(1024).fill(10), [])
    const fourth = writer.take()
    assert.equal(fourth.buffer, first.buffer)
    assert.ok(fourth.every((value) => value === 10))
    assert.notDeepEqual(second, kept, 'handed back, it was reused')
    writer.put([1], [])
    const fifth = writer.take()
    assert.notEqual(fifth.buffer, first.buffer)
    assert.ok(
      fourth.every((value) => value === 10),
      'a frame not handed back is never reused',
    )
  }
})
