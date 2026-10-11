// The range of indices written since the last upload: grown in place, an empty one taking the first.
import test from 'node:test'
import assert from 'node:assert/strict'
import { extendSpan, type Span } from './span.ts'

test('an empty span takes the first index; a later one grows it on either side', () => {
  const span: Span = { from: Infinity, to: -1 }
  extendSpan(span, 5)
  assert.deepEqual(span, { from: 5, to: 5 })
  extendSpan(span, 9)
  extendSpan(span, 2)
  assert.deepEqual(span, { from: 2, to: 9 })
})

test('a range grows the span to both of its ends, and one inside it changes nothing', () => {
  const span: Span = { from: 4, to: 6 }
  extendSpan(span, 5, 5)
  assert.deepEqual(span, { from: 4, to: 6 })
  extendSpan(span, 1, 8)
  assert.deepEqual(span, { from: 1, to: 8 })
})
