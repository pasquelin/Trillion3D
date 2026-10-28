// The explorer's writer of the ambient cubemap's cube (`ruleApi.ts`): a cube checked as at the opening, written into the context the
// next image reads, taken away by none, refused when the session is no longer live.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { EngineContext } from '../session/engine/types.ts'
import { createExplorerRuleApi } from './ruleApi.ts'

const cube = (size: number) => ({
  size,
  texels: new Float32Array(6 * size * size * 3).fill(0.5),
})

test('the ambient cubemap’s cube is written to the context, replaced and taken away', () => {
  const context = {} as EngineContext
  let checks = 0
  const api = createExplorerRuleApi({ check: () => void checks++, context })
  const first = cube(16)
  api.setAmbientCubemapCube(first)
  assert.equal(context.ambientCubemap?.size, 16)
  const second = cube(32)
  api.setAmbientCubemapCube(second)
  assert.equal(context.ambientCubemap?.size, 32)
  api.setAmbientCubemapCube(null)
  assert.equal(context.ambientCubemap, undefined)
  api.setAmbientCubemapCube(first)
  api.setAmbientCubemapCube()
  assert.equal(context.ambientCubemap, undefined)
  assert.equal(checks, 5, 'each write asks whether the session is live')
})

test('a cube of another form is refused by name and leaves the context as it was', () => {
  const context = {} as EngineContext
  const api = createExplorerRuleApi({ check: () => undefined, context })
  api.setAmbientCubemapCube(cube(16))
  assert.throws(() => api.setAmbientCubemapCube(cube(24)), /ambientCubemap/)
  assert.equal(context.ambientCubemap?.size, 16)
})
