// The installed page's no-hole check can fail: it compares what the engine
// drew with the scene's own full-detail count, which no engine counter copies.
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawsItsWholeCut } from './browser-result.ts'
import { INSTALLED_SCENE_TRIANGLES } from './scene.ts'

test('a frame that draws the scene at full detail passes', () => {
  assert.equal(
    drawsItsWholeCut({
      selectedTriangles: INSTALLED_SCENE_TRIANGLES,
      drawnTriangles: INSTALLED_SCENE_TRIANGLES,
    }),
    true,
  )
})

test('a hole, a coarser stand-in, overdraw or a missing count fails', () => {
  // The engine's two counters agreeing proves nothing: they are one counter on WebGPU.
  for (const drawn of [
    INSTALLED_SCENE_TRIANGLES - 2,
    INSTALLED_SCENE_TRIANGLES / 4,
    INSTALLED_SCENE_TRIANGLES + 2,
    0,
  ])
    assert.equal(drawsItsWholeCut({ selectedTriangles: drawn, drawnTriangles: drawn }), false)
  assert.equal(
    drawsItsWholeCut({ selectedTriangles: INSTALLED_SCENE_TRIANGLES, drawnTriangles: null }),
    false,
  )
  assert.equal(drawsItsWholeCut(undefined), false)
})
