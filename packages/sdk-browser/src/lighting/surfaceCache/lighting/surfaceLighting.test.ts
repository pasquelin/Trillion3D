// The surface cache's lighting state (`surfaceLighting.ts`): when the direct-light layer of the atlas is cleared.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createSurfaceLighting } from './surfaceLighting.ts'
import { directLayerStale } from './directLayer.ts'
import { lightingSettings } from './params.fixture.ts'

const withDirect = (on: boolean) => ({ ...lightingSettings, surfaceCacheDirectLighting: on })

test('the direct-light layer is cleared once as the direct light turns off, not again while it stays off', () => {
  const state = createSurfaceLighting()
  assert.equal(directLayerStale(state, withDirect(false)), true)
  assert.equal(directLayerStale(state, withDirect(false)), false)
  assert.equal(directLayerStale(state, withDirect(false)), false)
})

test('the layer is not cleared while the direct light is on, and again once it turns off after being on', () => {
  const state = createSurfaceLighting()
  assert.equal(directLayerStale(state, withDirect(true)), false)
  assert.equal(directLayerStale(state, withDirect(true)), false)
  assert.equal(directLayerStale(state, withDirect(false)), true)
  assert.equal(directLayerStale(state, withDirect(true)), false)
  assert.equal(directLayerStale(state, withDirect(false)), true)
})
