// The adaptive placement's dispatch counts every tile of the image, rounded up as the uniform probes' are: the reference rounds down (`ScreenProbeGather.cpp:2348`) and loses a row or a column of adaptive samples.

import test from 'node:test'
import assert from 'node:assert/strict'
import { adaptiveWorkgroups, geometryOfTile } from './screen/screenProbeLayout.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'

test('the adaptive placement dispatches over the tiles rounded up: the last partial tile row or column is reached, an odd image size included', () => {
  const settings = screenProbeSettings()
  const samples = { samplesX: 2, samplesY: 2 }
  // 1080 / 16 = 67.5: 68 tiles, 136 threads, 17 workgroups of 8.
  assert.deepEqual(
    adaptiveWorkgroups({ width: 1920, height: 1080, tile: 16, ...samples }),
    [30, 17],
  )
  // 1100 / 16 = 68.75: 69 tiles, 138 threads, 18 workgroups: the 69th tile, partial, gets its adaptive samples (rounded down it would have none).
  assert.equal(adaptiveWorkgroups({ width: 1920, height: 1100, tile: 16, ...samples })[1], 18)
  assert.equal(geometryOfTile(1920, 1100, 16, settings).tilesY, 69)
  // The odd size of a render zone halved, 2056 × 1147: 129 by 72 tiles, none lost, in rows of samples as many.
  const odd = geometryOfTile(2056, 1147, 16, settings)
  assert.deepEqual([odd.tilesX, odd.tilesY], [129, 72])
  assert.deepEqual(
    adaptiveWorkgroups({ width: 2056, height: 1147, tile: 16, ...samples }),
    [33, 18],
  )
  // Four samples along each axis: two tiles a workgroup.
  assert.deepEqual(
    adaptiveWorkgroups({ width: 1920, height: 1100, tile: 16, samplesX: 4, samplesY: 4 }),
    [60, 35],
  )
})
