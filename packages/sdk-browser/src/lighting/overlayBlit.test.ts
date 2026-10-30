// The overlay blit: the part of a rectangle the display holds.
import assert from 'node:assert/strict'
import test from 'node:test'
import { clipOverlay } from './overlayBlit.ts'

test('a rectangle the display holds whole is itself', () => {
  const rect = { x: 50, y: 220, width: 480, height: 480 }
  assert.equal(clipOverlay(rect, [1920, 1080]), rect)
})

test('a rectangle past the display is cut to the display, its corner kept', () => {
  assert.deepEqual(clipOverlay({ x: 50, y: 220, width: 960, height: 960 }, [3840, 1080]), {
    x: 50,
    y: 220,
    width: 960,
    height: 860,
  })
})

test('a rectangle the display holds no pixel of is none', () => {
  assert.equal(clipOverlay({ x: 50, y: 1080, width: 10, height: 10 }, [1920, 1080]), undefined)
  assert.equal(clipOverlay({ x: 2000, y: 0, width: 10, height: 10 }, [1920, 1080]), undefined)
})
