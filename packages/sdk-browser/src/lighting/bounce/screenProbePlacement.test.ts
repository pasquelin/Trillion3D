// The adaptive placement's dispatch counts the whole tiles of the image, rounded down, as the uniform probes' tiles are rounded up.

import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptiveWorkgroups, geometryOfTile } from './screen/screenProbeLayout.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'

test('the adaptive placement dispatches over the tiles rounded down: the last partial tile row or column is reached only by a workgroup the whole tiles fill', () => {
  const settings = screenProbeSettings()
  const samples = { samplesX: 2, samplesY: 2 }
  // 1080 / 16 = 67.5: 67 whole tiles, 134 threads, 17 workgroups of 8 that reach 68 tiles; the 68th is a partial one and is reached.
  assert.deepEqual(
    adaptiveWorkgroups({ width: 1920, height: 1080, tile: 16, ...samples }),
    [30, 17],
  )
  // 1100 / 16 = 68.75: 68 whole tiles, 136 threads, 17 workgroups that reach 68 tiles (rounded up, 69 tiles would take 18);
  // the 69th, partial, gets no adaptive sample.
  assert.equal(adaptiveWorkgroups({ width: 1920, height: 1100, tile: 16, ...samples })[1], 17)
  assert.equal(
    geometryOfTile(1920, 1100, 16, settings).tilesY,
    69,
    'the uniform probes cover it all the same',
  )
  // Four samples along each axis: two tiles a workgroup.
  assert.deepEqual(
    adaptiveWorkgroups({ width: 1920, height: 1100, tile: 16, samplesX: 4, samplesY: 4 }),
    [60, 34],
  )
})
