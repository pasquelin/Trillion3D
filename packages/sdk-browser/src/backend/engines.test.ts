import test from 'node:test'
import assert from 'node:assert/strict'
import { families } from '../host/families.ts'
import { engineBackends, loadRenderers } from './engines.ts'
import { webgpuPagesBackend } from '../webgpu/pages/pages.ts'

test('a session loads the renderer it draws with, never the other one', async () => {
  assert.equal(families.webgpu.arrived, false)
  await loadRenderers([engineBackends.webgpu])
  assert.equal(families.webgpu.arrived, true)
  assert.equal(families.webgl2.arrived, false)
  // The core's factory and the family's own carry the same mark, which the session reads.
  assert.equal(engineBackends.webgpu.renderer, webgpuPagesBackend.renderer)
  // A witness named by the host marks no renderer and loads none.
  await loadRenderers([() => ({}) as never])
  assert.equal(families.webgl2.arrived, false)
})
