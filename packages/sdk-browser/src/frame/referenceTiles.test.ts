import test from 'node:test'
import assert from 'node:assert/strict'
import { referenceTilePlan } from './referenceTiles.ts'
import { createEngineCamera, writeEngineCamera } from '../camera/engineCamera.ts'
import { GUARANTEED_SIDE } from '../gpu/core/textureLimits.ts'
import { placeTile, REFERENCE_MAX_TILES } from './referenceTilePlacement.ts'

const BOSS = { width: 1728, height: 1117, pixelRatio: 2 }

test('the plan tiles the display, each tile’s supersampled target within the portable side', () => {
  const plan = referenceTilePlan(BOSS.width, BOSS.height, BOSS.pixelRatio)
  assert.equal(plan.width, 3456)
  assert.equal(plan.height, 2234)
  assert.ok(plan.factor > 2, `heavy, not the 2 a single canvas caps at: got ${plan.factor}`)
  assert.ok(plan.tiles.length <= REFERENCE_MAX_TILES)
  // Every output pixel lies in exactly one tile, and none overflows one.
  const covered = new Uint8Array(plan.width * plan.height)
  for (const tile of plan.tiles) {
    assert.ok(tile.width * plan.factor <= GUARANTEED_SIDE)
    assert.ok(tile.height * plan.factor <= GUARANTEED_SIDE)
    for (let row = 0; row < tile.height; row++)
      for (let col = 0; col < tile.width; col++) {
        const cell: number = (tile.y + row) * plan.width + tile.x + col
        assert.equal(covered[cell], 0, `tile overlaps at ${tile.x + col}, ${tile.y + row}`)
        covered[cell] = 1
      }
  }
  assert.ok(
    covered.every((value) => value === 1),
    'no gap',
  )
})

test('the factor falls only when the tile cap would be crossed', () => {
  const plan = referenceTilePlan(1728, 1117, 2, 64, 4)
  assert.equal(plan.factor, 4, '4×4 tiles at 64 samples exceed the cap, so it halves the factor')
  assert.ok(plan.tiles.length <= 4)
})

test('a tile projection maps the tile’s region of the full view onto the target', () => {
  const plan = referenceTilePlan(BOSS.width, BOSS.height, BOSS.pixelRatio)
  const tile = plan.tiles[Math.floor(plan.tiles.length / 2)]
  const full = writeEngineCamera(createEngineCamera(), {
    fov: 55,
    aspect: plan.width / plan.height,
    near: 0.1,
    far: 1000,
    zoom: 1,
  })
  const part = writeEngineCamera(createEngineCamera(), {
    fov: 55,
    aspect: (tile.width * plan.factor) / (tile.height * plan.factor),
    near: 0.1,
    far: 1000,
    zoom: 1,
    viewTile: tile,
  })
  const ndc = (projection: Float64Array, x: number, y: number, z: number) => {
    const v = [x, y, z, 1],
      clip = [0, 0, 0, 0]
    for (let row = 0; row < 4; row++)
      for (let column = 0; column < 4; column++)
        clip[row] += projection[column * 4 + row] * v[column]
    return [clip[0] / clip[3], clip[1] / clip[3]]
  }
  const centerX = (tile.x + (tile.x + tile.width)) / plan.width - 1,
    centerY = (tile.y + (tile.y + tile.height)) / plan.height - 1
  for (const [x, y] of [
    [0, 0],
    [0.3, -0.2],
    [-0.5, 0.4],
  ]) {
    const [fx, fy] = ndc(full.projection, x, y, -1),
      [tx, ty] = ndc(part.projection, x, y, -1)
    assert.ok(Math.abs(tx - (plan.width / tile.width) * (fx - centerX)) < 1e-9)
    assert.ok(Math.abs(ty - (plan.height / tile.height) * (fy - centerY)) < 1e-9)
  }
})

test('an orthographic tile projection maps the same region, its translation read at w = 1', () => {
  const plan = referenceTilePlan(BOSS.width, BOSS.height, BOSS.pixelRatio)
  const tile = plan.tiles[0]
  const box = { left: -4, right: 4, bottom: -3, top: 3, fitAspect: true }
  const optics = { fov: 55, near: 0.1, far: 1000, zoom: 1, orthographic: box }
  const full = writeEngineCamera(createEngineCamera(), {
    ...optics,
    aspect: plan.width / plan.height,
  })
  const part = writeEngineCamera(createEngineCamera(), {
    ...optics,
    aspect: tile.width / tile.height,
    viewTile: tile,
  })
  const ndc = (p: Float64Array, x: number, y: number) => [
    p[0] * x + p[4] * y + p[12],
    p[1] * x + p[5] * y + p[13],
  ]
  const centerX = (2 * tile.x + tile.width) / plan.width - 1,
    centerY = (2 * tile.y + tile.height) / plan.height - 1
  for (const [x, y] of [
    [0, 0],
    [1.3, -0.7],
    [-2.5, 1.4],
  ]) {
    const [fx, fy] = ndc(full.projection, x, y),
      [tx, ty] = ndc(part.projection, x, y)
    assert.ok(Math.abs(tx - (plan.width / tile.width) * (fx - centerX)) < 1e-9)
    assert.ok(Math.abs(ty - (plan.height / tile.height) * (fy - centerY)) < 1e-9)
  }
})

test('the resolved tiles are placed at their output origin, bottom row first', () => {
  const plan = referenceTilePlan(32, 16, 1, 1, 64)
  const out = new Uint8Array(plan.width * plan.height * 4)
  const tile = plan.tiles[plan.tiles.length - 1]
  const resolved = new Uint8Array(tile.width * tile.height * 4).fill(7)
  placeTile(out, plan.width, tile, resolved)
  // Every pixel of the tile is written, and nothing outside it is.
  assert.equal(out[(tile.y * plan.width + tile.x) * 4], 7)
  assert.equal(out[((tile.y + tile.height - 1) * plan.width + tile.x + tile.width - 1) * 4], 7)
  assert.equal(out[0], tile.x === 0 && tile.y === 0 ? 7 : 0)
})
