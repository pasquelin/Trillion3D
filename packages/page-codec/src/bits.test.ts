import test from 'node:test'
import assert from 'node:assert/strict'
import { field } from './bits.ts'

/** The `bits` bits at bit `at`, read one bit at a time: the format packs a field least significant
 *  bit first within a word and continues in the next word, which is what `Packer.push` writes
 *  (`pageGrids.ts`). An oracle that cannot be wrong in the same way as a shift and a mask. */
function bitAtATime(words: Uint32Array, at: number, bits: number) {
  let value = 0
  for (let b = 0; b < bits; b++) {
    const bit = at + b
    value |= ((words[bit >>> 5] >>> (bit & 31)) & 1) << b
  }
  return value
}

test('the cases the shared codec holds: a field across a word boundary, and a field of no width', () => {
  // `bits_tests.rs`: `field(28, 12)`, `field(28, 0)` and `field(32, 8)` over these two words, so a
  // page the compiler packs is read the same on this side.
  const words = new Uint32Array([0xf0000000, 0x000000ab])
  assert.equal(field(words, 28, 12), 0xabf, '12 bits at 28 cross into the next word')
  assert.equal(field(words, 28, 0), 0, 'a field of no width reads zero')
  assert.equal(field(words, 32, 8), 0xab, 'a field at a word boundary needs no carry')
})

test('every field the format admits reads what a bit-at-a-time reader finds', () => {
  // `MAX_BITS` is the widest field the format holds, so a field spans two words at most and the
  // next word exists whenever one is needed. Both shapes of word array are covered: the corners'
  // and the one above.
  const arrays = [
    new Uint32Array([0xf0000000, 0x000000ab, 0xdeadbeef, 0x00000001]),
    new Uint32Array(Array.from({ length: 16 }, (_, i) => Math.imul(i + 1, 0x9e3779b9) >>> 0)),
  ]
  for (const words of arrays) {
    for (let bits = 0; bits <= 24; bits++)
      for (let at = 0; at < words.length * 32 - 32; at++)
        assert.equal(
          field(words, at, bits),
          bitAtATime(words, at, bits),
          `${bits} bits at ${at} of ${words[0].toString(16)}`,
        )
  }
})

test('a field of no width reads zero, and no word is read for it', () => {
  // `bits === 0` returns before the first word is touched, so a zero-width stream may sit at the
  // very end of a page without reading past it. The reads are counted rather than inferred from
  // the value, because a value of zero is what a wrong reader returns too.
  let reads = 0
  const counted = new Proxy(new Uint32Array([0xffffffff, 0x12345678]), {
    get(target, at) {
      // The receiver is left off: a typed array's getters brand-check `this`, and the proxy is not
      // a typed array.
      if (typeof at === 'string' && /^\d+$/.test(at)) reads++
      return Reflect.get(target, at)
    },
  })
  for (let at = 0; at < counted.length * 32; at++) assert.equal(field(counted, at, 0), 0)
  assert.equal(reads, 0, 'a field of no width loads no word')
})
