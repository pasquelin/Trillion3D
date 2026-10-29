import test from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPLEXITY_ENTRY_WORDS,
  COMPLEXITY_HEADER,
  COMPLEXITY_HEADER_WORDS,
  COMPLEXITY_KIND,
  COMPLEXITY_MAX_LIGHTS,
  COMPLEXITY_RESULT_BYTES,
  COMPLEXITY_RESULT_WORDS,
  decodeComplexity,
} from './entries.ts'

/** The first word of a light as the replay writes it: its rank, whether it was seen and its kind. */
const packComplexityLight = (rank: number, seen: number, kind: number) =>
  ((rank & 0xffff) | ((seen & 0xff) << 16) | ((kind & 0xff) << 24)) >>> 0

/** A result of the replay with `lights` (rank, seen, kind, weight, place, colour) listed. */
function resultOf(
  lights: readonly (readonly [number, number, number, number, number[], number[]])[],
  sum: number,
  position: number[] = [1, 2, 3],
) {
  const words = new Uint32Array(COMPLEXITY_RESULT_WORDS)
  const floats = new Float32Array(words.buffer)
  words[COMPLEXITY_HEADER.count] = lights.length
  floats[COMPLEXITY_HEADER.sum] = sum
  floats.set(position, COMPLEXITY_HEADER.position)
  words[COMPLEXITY_HEADER.valid] = 1
  words[COMPLEXITY_HEADER.written] = 1
  lights.forEach(([rank, seen, kind, weight, place, color], index) => {
    const at = COMPLEXITY_HEADER_WORDS + index * COMPLEXITY_ENTRY_WORDS
    words[at] = packComplexityLight(rank, seen, kind)
    floats[at + 1] = weight
    floats.set(place, at + 2)
    floats.set(color, at + 5)
  })
  return words
}

test('the result is a header and eight words a light, sized for the most lights the sort holds', () => {
  assert.equal(COMPLEXITY_RESULT_WORDS, COMPLEXITY_HEADER_WORDS + 512 * 8)
  assert.equal(COMPLEXITY_RESULT_BYTES, COMPLEXITY_RESULT_WORDS * 4)
  assert.equal(COMPLEXITY_MAX_LIGHTS, 512)
})

test('a light is packed as rank, seen and kind in its first word', () => {
  assert.equal(packComplexityLight(7, 255, COMPLEXITY_KIND.rect), (3 << 24) | (255 << 16) | 7)
  assert.equal(packComplexityLight(0xffff, 0, 0), 0xffff)
})

test('the list decodes the lights in the order the replay wrote them, with their place and colour', () => {
  const words = resultOf(
    [
      [4, 255, COMPLEXITY_KIND.point, 2.5, [1, 0, 0], [1, 0.5, 0.25]],
      [9, 0, COMPLEXITY_KIND.directional, 0.5, [0, 0, 1], [1, 1, 1]],
    ],
    3,
  )
  const list = decodeComplexity(words)
  assert.equal(list.valid, true)
  assert.deepEqual(list.position, [1, 2, 3])
  assert.equal(list.sum, 3)
  assert.equal(list.lights.length, 2)
  assert.deepEqual(list.lights[0], {
    rank: 4,
    seen: 1,
    kind: COMPLEXITY_KIND.point,
    weight: 2.5,
    place: [1, 0, 0],
    color: [1, 0.5, 0.25],
  })
  assert.equal(list.lights[1]!.kind, COMPLEXITY_KIND.directional)
  assert.equal(list.lights[1]!.seen, 0)
})

test('a pixel no light is drawn over decodes as an empty list that is not valid', () => {
  const list = decodeComplexity(new Uint32Array(COMPLEXITY_RESULT_WORDS))
  assert.equal(list.valid, false)
  assert.equal(list.written, false)
  assert.equal(list.lights.length, 0)
})

test('a count past the most lights is held to it', () => {
  const words = new Uint32Array(COMPLEXITY_RESULT_WORDS)
  words[COMPLEXITY_HEADER.count] = 100000
  assert.equal(decodeComplexity(words).lights.length, COMPLEXITY_MAX_LIGHTS)
})
