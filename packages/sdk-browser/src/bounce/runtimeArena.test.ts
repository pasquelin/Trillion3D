import test from 'node:test'
import assert from 'node:assert/strict'
import { createSpans } from './runtimeArena.ts'

test('ranges are taken one after another, and a freed range is taken again first', () => {
  const spans = createSpans(100)
  assert.equal(spans.take(10), 0)
  assert.equal(spans.take(20), 10)
  assert.equal(spans.take(5), 30)
  spans.release(10, 20)
  assert.equal(spans.take(8), 10)
  assert.equal(spans.take(12), 18)
  assert.equal(spans.used, 35)
})

test('freed neighbours join, and a freed tail gives the used part back', () => {
  const spans = createSpans(64)
  spans.take(16)
  spans.take(16)
  spans.take(16)
  spans.release(0, 16)
  spans.release(16, 16)
  assert.equal(spans.take(32), 0)
  spans.release(32, 16)
  spans.release(0, 32)
  assert.equal(spans.extent, 0)
  assert.equal(spans.take(64), 0)
})

test('a table past its capacity answers nothing until it is grown', () => {
  const spans = createSpans(8)
  assert.equal(spans.take(8), 0)
  assert.equal(spans.take(1), undefined)
  assert.equal(spans.grown(9), 16)
  assert.equal(spans.take(1), 8)
  assert.equal(spans.take(0), 9)
})
