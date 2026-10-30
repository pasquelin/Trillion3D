import test from 'node:test'
import assert from 'node:assert/strict'
import { MATERIAL_SETTINGS, SKY_EXTRA } from './materialAbi.ts'
import { resolveMaterials } from './materialOptions.ts'

test('a material may be named a sky material, beside its responsiveness', () => {
  assert.ok(MATERIAL_SETTINGS.includes(SKY_EXTRA))
  assert.deepEqual(
    resolveMaterials({ dome: { sky: true }, plain: { sky: false, responsive: 'medium' } }),
    { dome: { sky: true }, plain: { sky: false, responsive: 'medium' } },
  )
})

test('the sky property is a boolean, or left out', () => {
  assert.deepEqual(resolveMaterials({ dome: {} }), { dome: {} })
  assert.deepEqual(resolveMaterials({ dome: { sky: null as never } }), { dome: {} })
  assert.throws(() => resolveMaterials({ dome: { sky: 'yes' as never } }), /materials\.dome\.sky/)
})
