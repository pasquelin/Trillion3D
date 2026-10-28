// The full build's depth tile holds every texel the planes of a workgroup's squares read, whatever the
// size of the level: the last square of an odd level starts one texel back (`hizSquareStart`), and its
// plane reaches one texel further behind the workgroup's first pixel than any other's. A texel read
// outside the tile is another's (the tile is indexed by row), so a plane at the edge of an odd image was
// built from the wrong depths.
import test from 'node:test'
import assert from 'node:assert/strict'
import { HIZ_DEPTH_TILE, HIZ_PLANE_REACH, HIZ_TILE_BEHIND } from './shader.ts'
import { HIZ_BUILD_SIDE } from './uniforms.ts'
import { hizSquareStart } from '../../../../../sdk-core/src/hiz/oracles.fixture.ts'

/** The first pixel of the tile of workgroup `wg` and the pixels it holds on one axis. */
const tileAxis = (wg: number) => {
  const origin = wg * 2 * HIZ_BUILD_SIDE - HIZ_TILE_BEHIND
  return [origin, origin + HIZ_DEPTH_TILE - 1] as const
}

test('every texel a plane of the first pass reads lies in the workgroup’s tile, at every size', () => {
  for (let size = 1; size <= 80; size++) {
    const last = size - 1
    for (let cell = 0; 2 * cell < size; cell++) {
      const wg = Math.floor(cell / HIZ_BUILD_SIDE)
      const [low, high] = tileAxis(wg)
      const start = hizSquareStart(cell, size, true)
      // The square's pixels, then each plane's neighbours up to the reach: read at their own place in the
      // tile, which holds the clamped texel there (`hizLoadDepthTile`), so the place itself must be in it.
      for (let q = start; q <= Math.min(start + 1, last); q++)
        for (let d = -HIZ_PLANE_REACH; d <= HIZ_PLANE_REACH; d++)
          assert.ok(
            q + d >= low && q + d <= high,
            `size ${size}, cell ${cell}: pixel ${q + d} is outside [${low}, ${high}]`,
          )
    }
  }
})

test('the tile reaches one texel further behind than the planes’ reach, for the shifted square', () => {
  assert.equal(HIZ_TILE_BEHIND, HIZ_PLANE_REACH + 1)
  assert.equal(HIZ_DEPTH_TILE, 2 * HIZ_BUILD_SIDE + HIZ_TILE_BEHIND + HIZ_PLANE_REACH)
  // 17 texels: the last cell, 8, is the first lane of the second workgroup and its square starts at 15.
  assert.equal(hizSquareStart(8, 17, true), 15)
  const [low] = tileAxis(1)
  assert.ok(15 - HIZ_PLANE_REACH >= low, 'the plane of pixel 15 reads pixel 13')
})
