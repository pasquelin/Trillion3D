import assert from 'node:assert/strict'
import test from 'node:test'
import { textSegments } from './debugFont.ts'

/** The segments of `text` at cell size 1 from the origin. */
const segmentsOf = (text: string) => {
  const found: number[][] = []
  textSegments(text, 0, 0, 1, (x0, y0, x1, y1) => found.push([x0, y0, x1, y1]))
  return found
}

test('every glyph is five rows of three cells and differs from the others', () => {
  const seen = new Map<string, string>()
  for (const char of ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:.,/-%()') {
    const key = JSON.stringify(segmentsOf(char))
    if (char !== ' ') assert.notEqual(key, '[]', char)
    assert.equal(seen.get(key), undefined, `${char} equals ${seen.get(key)}`)
    seen.set(key, char)
  }
})

test('a run of lit cells is one segment from the middle of its first cell to the middle of its last', () => {
  assert.deepEqual(segmentsOf('-'), [[0.5, 2.5, 2.5, 2.5]])
  assert.deepEqual(segmentsOf('T')[0], [0.5, 0.5, 2.5, 0.5])
})

test('a character advances the pen and a new line goes down', () => {
  const [x, y] = textSegments('AB\nC', 10, 20, 2, () => {})
  // A character is four cells and a line seven, the cells two pixels.
  assert.equal(x, 10 + 4 * 2)
  assert.equal(y, 20 + 7 * 2)
  assert.deepEqual(segmentsOf('a'), segmentsOf('A'))
  assert.deepEqual(segmentsOf('~'), [])
})
