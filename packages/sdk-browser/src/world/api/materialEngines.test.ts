// A material change reaches every engine of the session, even once one has not taken it.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { RenderBackend } from '../../backend/types.ts'
import { materialEngines } from './materialEngines.ts'

test('every engine rereads its surfaces, even after one has not taken the change', () => {
  const asked: string[] = []
  const engine = (id: string, taken: boolean) =>
    ({
      id,
      refreshMaterials: () => {
        asked.push(id)
        return taken
      },
    }) as unknown as RenderBackend
  const backends = [engine('webgpu', false), engine('webgl2', true)]
  const { refreshed } = materialEngines(backends, () => backends[0])
  assert.equal(refreshed(), false, 'one engine did not take it')
  assert.deepEqual(asked, ['webgpu', 'webgl2'], 'the second was asked all the same')
})
