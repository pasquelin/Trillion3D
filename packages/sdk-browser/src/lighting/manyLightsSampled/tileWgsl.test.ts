import test from 'node:test'
import assert from 'node:assert/strict'
import { SAMPLED_TILE } from './parameters.ts'
import {
  TILE_BITMASK_ENTRY,
  TILE_LISTS_ENTRY,
  TILE_ARGS_ENTRY,
  tileArgsWgsl,
  tileBitmaskWgsl,
  tileListsWgsl,
} from './tileWgsl.ts'

test('the kernels declare their entries, and the WGSL holds the same mode numbers as the reference', () => {
  const bitmask = tileBitmaskWgsl()
  assert.ok(bitmask.includes(`fn ${TILE_BITMASK_ENTRY}(`))
  const lists = tileListsWgsl()
  assert.ok(lists.includes(`fn ${TILE_LISTS_ENTRY}(`))
  for (const mode of Object.values(SAMPLED_TILE))
    assert.ok(lists.includes(`${mode}u`), String(mode))
  assert.ok(tileArgsWgsl().includes(`fn ${TILE_ARGS_ENTRY}(`))
})

test('the bits kernel of the layer runs one group a listed tile, the surfaces one a tile of the view', () => {
  const listed = tileBitmaskWgsl(true)
  assert.ok(listed.includes('listedTile(block)'))
  assert.ok(listed.includes('listedIndex(block)<tileAllocator[0]'))
  const whole = tileBitmaskWgsl()
  assert.ok(!whole.includes('listedTile'))
  assert.ok(!whole.includes('let live='))
  assert.ok(whole.includes('@builtin(global_invocation_id) id:vec3u'))
  assert.ok(whole.includes('if(id.x<u32(view.viewport.x)'))
})
