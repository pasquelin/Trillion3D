import test from 'node:test'
import assert from 'node:assert/strict'
import { blendReceiverSurface } from './penumbraScene.ts'

test('the blended receiver is lit forward: only that lighting reads the shadow maps', () => {
  assert.equal(blendReceiverSurface().translucencyLighting, 'forward')
})
