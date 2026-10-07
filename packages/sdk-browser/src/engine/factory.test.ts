import test from 'node:test'
import assert from 'node:assert/strict'
import { families } from '../host/families.ts'
import { loadEngine } from './factory.ts'

test('the session loads the renderer family the engine draws with', async () => {
  assert.equal(families.webgpu.arrived, false)
  await loadEngine()
  assert.equal(families.webgpu.arrived, true)
})
