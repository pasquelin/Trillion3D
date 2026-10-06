import assert from 'node:assert/strict'
import test from 'node:test'
import type { MeasuredWorld } from '../session/explorer.ts'
import { worldMaterialMethods } from './worldMaterialMethods.ts'

test('public material methods use the current drawing session and invalidate after writes', () => {
  const calls: string[] = []
  const imported = [{ id: '0' }]
  const created = { id: 'created-0' }
  const session = {
    materials: () => (calls.push('materials'), imported),
    material: (id: string) => (calls.push(`material:${id}`), imported[0]),
    importedMaterials: () => (calls.push('importedMaterials'), imported),
    setMaterial: (id: string) => (calls.push(`setMaterial:${id}`), true),
    createMaterial: () => (calls.push('createMaterial'), created),
    assignMaterial: (primitive: string, id: string) => (
      calls.push(`assignMaterial:${primitive}:${id}`),
      false
    ),
  } as unknown as MeasuredWorld
  const api = worldMaterialMethods(
    () => session,
    () => calls.push('invalidate'),
  )

  assert.equal(api.materials(), imported)
  assert.equal(api.material('0'), imported[0])
  assert.equal(api.importedMaterials(), imported)
  assert.equal(api.setMaterial('0', { opacity: 0.5 }), true)
  assert.equal(api.createMaterial({ name: 'page' }), created)
  assert.equal(api.assignMaterial('1/2', created.id), false)
  assert.deepEqual(calls, [
    'materials',
    'material:0',
    'importedMaterials',
    'setMaterial:0',
    'invalidate',
    'createMaterial',
    'assignMaterial:1/2:created-0',
    'invalidate',
  ])
})

test('material methods refuse a world without an open drawing session', () => {
  const api = worldMaterialMethods(
    () => null,
    () => assert.fail('no frame to invalidate'),
  )
  assert.throws(() => api.materials(), /add a model first/)
  assert.throws(() => api.setMaterial('0', {}), /add a model first/)
  assert.throws(() => api.createMaterial(), /add a model first/)
})
