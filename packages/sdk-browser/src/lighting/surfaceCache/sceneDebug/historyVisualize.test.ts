import test from 'node:test'
import assert from 'node:assert/strict'
import { HISTORY_VISUALIZE_WGSL } from './historyVisualize.ts'

test('the history view reads the second word of the shading and mixes the red with the image’s grey', () => {
  assert.match(HISTORY_VISUALIZE_WGSL, /textureLoad\(shadingTexture,texel,0\)\.y/)
  assert.match(HISTORY_VISUALIZE_WGSL, /mix\(vec3f\(grey\),vec3f\(amount,0\.0,0\.0\),0\.8\)/)
  assert.match(HISTORY_VISUALIZE_WGSL, /fn historyVisualizeFs/)
})
