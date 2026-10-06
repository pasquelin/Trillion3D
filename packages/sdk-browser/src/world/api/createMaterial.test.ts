// A page creates a material of its own (#847): its values checked as a change's are, what it does
// not take refused by name,  and a ceiling on how many.
import test from 'node:test'
import assert from 'node:assert/strict'
import { RUNTIME_MATERIAL_CEILING } from './createdMaterials.ts'
import { refusal, scene } from './materialApi.fixture.ts'

test('a created material reads back what the page named, glTF defaults elsewhere', async () => {
  const { api } = await scene()
  const made = api.createMaterial({
    name: 'paint',
    baseColor: [0.25, 0.5, 0.75],
    roughness: 0.5,
    alphaMode: 'mask',
    alphaCutoff: 0.25,
  })
  assert.deepEqual(made, {
    id: 'created-0',
    name: 'paint',
    baseColor: [0.25, 0.5, 0.75],
    opacity: 1,
    metalness: 1,
    roughness: 0.5,
    emissive: [0, 0, 0],
    side: 'front',
    alphaMode: 'mask',
    alphaCutoff: 0.25,
    tiling: null,
  })
  assert.deepEqual(api.material(made.id), made)
  assert.deepEqual(api.materials().at(-1), made, 'listed after the scene materials')
  assert.equal(api.createMaterial().id, 'created-1')
  // A value named undefined is one not named: the default, not a hole in the surface.
  const unnamed = api.createMaterial({ baseColor: undefined, opacity: undefined, map: undefined })
  assert.deepEqual([unnamed.baseColor, unnamed.opacity], [[1, 1, 1], 1])
})

test('a created material is refused by name before anything is built, then set as any other', async () => {
  const { api, refreshes } = await scene()
  assert.throws(() => api.createMaterial({ map: {} as ImageBitmap }), refusal('INVALID_MATERIAL'))
  assert.throws(() => api.createMaterial({ roughness: 2 }), refusal('INVALID_MATERIAL'))
  assert.equal(api.materials().length, 5, 'nothing created')
  // A created material is set as a scene material is, its values checked the same way.
  const made = api.createMaterial().id
  assert.throws(() => api.setMaterial(made, { roughness: 2 }), refusal('INVALID_MATERIAL'))
  assert.equal(api.setMaterial(made, { roughness: 0.25, alphaMode: 'blend' }), true)
  assert.deepEqual([api.material(made).roughness, api.material(made).alphaMode], [0.25, 'blend'])
  assert.equal(refreshes.length, 0, 'worn by nothing: no engine repaints, none refuses it')
  api.setMaterial(made, { alphaMode: 'mask' })
  api.setMaterial(made, { alphaCutoff: 0.75 })
  assert.equal(api.material(made).alphaCutoff, 0.75, 'a cutoff alone reaches the surface')
})

test('past the declared ceiling a created material is refused by name', async () => {
  const { api } = await scene()
  for (let n = 0; n < RUNTIME_MATERIAL_CEILING; n++) api.createMaterial()
  assert.throws(
    () => api.createMaterial(),
    (error: { code?: string; details?: { ceiling?: number } }) =>
      error.code === 'MATERIAL_CEILING' && error.details?.ceiling === RUNTIME_MATERIAL_CEILING,
  )
  assert.equal(api.materials().length, 5 + RUNTIME_MATERIAL_CEILING, 'nothing built above it')
})

test('what a created material or a change does not take is refused by name, never dropped', async () => {
  const { api } = await scene()
  for (const props of [{ tiling: [2, 2] }, { side: 'double' }, { shininess: 1 }, { name: 7 }])
    assert.throws(() => api.createMaterial(props as never), refusal('INVALID_MATERIAL'))
  assert.throws(() => api.setMaterial('0', { side: 'back' } as never), refusal('INVALID_MATERIAL'))
  assert.equal(api.materials().length, 5, 'nothing created')
})
