import test from 'node:test'
import assert from 'node:assert/strict'
import { VISUALIZE_ENTRY, VISUALIZE_WGSL } from './visualizeWgsl.ts'
import { VISUALIZE } from './modes.ts'
import { tileColor, tileClassificationOf, TILE_NAMES } from './tileOverlay.ts'
import { SAMPLED_TILE, SAMPLED_TILE_MODES } from '../parameters.ts'

test('the visualize program has its fragment and vertex entries and each denoiser view', () => {
  assert.ok(VISUALIZE_WGSL.includes(`fn ${VISUALIZE_ENTRY}(`))
  assert.ok(VISUALIZE_WGSL.includes('@vertex fn screenPassVs('))
  for (const view of Object.values(VISUALIZE).filter((v) => v >= 6))
    assert.ok(VISUALIZE_WGSL.includes(`mode==${view}u`), `view ${view}`)
  assert.ok(!VISUALIZE_WGSL.includes('`'))
})

test('the tile colours are the reference’s palette, rectangle and textured tiles a fifth toward red', () => {
  assert.deepEqual(tileColor(SAMPLED_TILE.simple), [0.5, 0.75, 0.5])
  assert.deepEqual(tileColor(SAMPLED_TILE.single), [1, 1, 0])
  const rect = tileColor(SAMPLED_TILE.complexRect)
  assert.ok(Math.abs(rect[0] - 0.8) < 1e-9 && Math.abs(rect[1] - 0.4) < 1e-9)
  const textured = tileColor(SAMPLED_TILE.complexRectTextured)
  assert.ok(Math.abs(textured[0] - 0.84) < 1e-9 && Math.abs(textured[1] - 0.32) < 1e-9)
  assert.equal(TILE_NAMES.length, SAMPLED_TILE_MODES)
})

test('the tile classification setting names an input and whether the downsampled tiles are drawn', () => {
  assert.deepEqual(tileClassificationOf(1), { input: 0, downsampled: false })
  assert.deepEqual(tileClassificationOf(2), { input: 0, downsampled: true })
  assert.deepEqual(tileClassificationOf(5), { input: 2, downsampled: false })
  assert.deepEqual(tileClassificationOf(6), { input: 2, downsampled: true })
})
