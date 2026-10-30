import test from 'node:test'
import assert from 'node:assert/strict'
import { SAMPLED_TILE_SIZE } from './parameters.ts'
import { FRONT_TILE_SIZE } from '../reflections/frontTiles.ts'
import {
  FRONT_TILE_ARGS_ENTRY,
  FRONT_TILE_LIST_ENTRY,
  FRONT_TILE_ROW,
  frontTileArgsWgsl,
  frontTileListWgsl,
} from './frontTilesWgsl.ts'

test('the front pass marks tiles of the size the classification uses', () => {
  assert.equal(FRONT_TILE_SIZE, SAMPLED_TILE_SIZE)
})

test('the list kernel reads the marks and clears the bits of every tile', () => {
  const code = frontTileListWgsl()
  assert.ok(code.includes(`fn ${FRONT_TILE_LIST_ENTRY}(`))
  assert.ok(!code.includes('textureStore(frontMask'))
  assert.ok(code.includes('textureStore(tileBitmask,tile,vec4u(0u))'))
  assert.ok(code.includes('id.x|(id.y<<16u)'))
})

test('the arguments split a long list in rows of groups', () => {
  const code = frontTileArgsWgsl()
  assert.ok(code.includes(`fn ${FRONT_TILE_ARGS_ENTRY}(`))
  assert.ok(code.includes(`min(count,${FRONT_TILE_ROW}u)`))
  assert.ok(FRONT_TILE_ROW <= 65535)
})
