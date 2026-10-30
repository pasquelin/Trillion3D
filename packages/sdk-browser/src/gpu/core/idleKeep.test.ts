import assert from 'node:assert/strict'
import test from 'node:test'
import { foldWindow, IDLE_KEEP_IMAGES } from './idleKeep.ts'

test('a window folds its asks, returns the most when it ends and restarts from the ask', () => {
  const window = { most: 0, since: 0 }
  const most = (a: number, b: number) => Math.max(a, b)
  assert.equal(foldWindow(window, 1, 5, most, 0), undefined)
  assert.equal(foldWindow(window, 2, 3, most, 0), undefined)
  assert.equal(foldWindow(window, IDLE_KEEP_IMAGES, 2, most, 0), 5)
  assert.deepEqual(window, { most: 2, since: IDLE_KEEP_IMAGES })
  assert.equal(foldWindow(window, 2 * IDLE_KEEP_IMAGES, undefined, most, 0), 2)
  assert.equal(window.most, 0)
})
