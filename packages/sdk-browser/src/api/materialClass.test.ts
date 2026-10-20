// A material moved between opaque, masked and blended inside the session: its surfaces
// are drawn as the open draws that class, each engine is told to move its drawables, and an engine
// that lays the class out at open refuses by name before any write.
import test from 'node:test'
import assert from 'node:assert/strict'
import { scene } from './materialApi.fixture.ts'

test('each of the six class changes lands in every surface, and the engines move its drawables', async () => {
  // An engine that sorts by surface at every draw refuses none.
  const { api, floor, refreshes } = await scene(() => undefined)
  // From opaque: to masked, blended, opaque, blended, masked, opaque — each transition once.
  const walk = ['mask', 'blend', 'opaque', 'blend', 'mask', 'opaque'] as const
  for (const alphaMode of walk) {
    api.setMaterial('0', { alphaMode })
    assert.equal(api.material('0').alphaMode, alphaMode)
    for (const surface of floor) {
      assert.equal(surface.transparent, alphaMode === 'blend', 'as the open draws a blend')
      assert.equal(surface.depthWrite, alphaMode !== 'blend')
      assert.equal(surface.alphaTest, alphaMode === 'mask' ? 0.5 : 0, "glTF's default cutoff")
    }
  }
  assert.deepEqual(
    refreshes.map((alpha) => [alpha?.from, alpha?.to, alpha?.surfaces]),
    walk.map((to, i) => [i ? walk[i - 1] : 'opaque', to, floor]),
    'each change hands the engines its surfaces, from and to',
  )
  api.setMaterial('0', { roughness: 0.5 })
  assert.equal(refreshes.at(-1), undefined, 'a value alone moves nothing')
  api.setMaterial('0', { alphaMode: 'mask', alphaCutoff: 0.25 })
  assert.equal(api.material('0').alphaCutoff, 0.25, 'the cutoff the page names')
  api.setMaterial('0', { alphaCutoff: 0 })
  assert.equal(api.material('0').alphaMode, 'opaque', 'a cutout at zero is opaque')
  api.setMaterial('0', { alphaCutoff: 0.5 })
  assert.equal(api.material('0').alphaMode, 'opaque', 'a cutoff never masks an opaque material')
})

test('WebGPU moves a material between opaque and masked, and refuses blended by name', async () => {
  const { api, floor, refreshes } = await scene()
  const version = floor[0].version
  for (const [id, patch] of [
    ['0', { alphaMode: 'blend', roughness: 0 }],
    ['1', { alphaMode: 'blend' }],
    ['4', { alphaMode: 'opaque' }],
    ['4', { alphaMode: 'mask' }],
  ] as const)
    assert.throws(
      () => api.setMaterial(id, patch),
      (error: { code?: string; details?: { engine?: string } }) =>
        error.code === 'MATERIAL_CLASS_CHANGE' && error.details?.engine === 'webgpu-page-raster',
    )
  assert.equal(floor[0].version, version, 'nothing written')
  assert.equal(api.material('0').roughness, 1)
  assert.equal(refreshes.length, 0)
  api.setMaterial('0', { alphaMode: 'mask' })
  api.setMaterial('1', { alphaCutoff: 0 })
  assert.deepEqual([api.material('0').alphaMode, api.material('1').alphaMode], ['mask', 'opaque'])
  assert.deepEqual(
    refreshes.map((alpha) => [alpha?.from, alpha?.to]),
    [
      ['opaque', 'mask'],
      ['mask', 'opaque'],
    ],
  )
})

// A cutout's cutoff moved: no class did, but what its shadow cuts did, and the engines hear
// it as they hear a class change; another value leaves the surface's alpha as the file drew it.
test('a cutoff moved on a masked material reaches the engines as an alpha change', async () => {
  const { api, refreshes } = await scene()
  api.setMaterial('1', { alphaCutoff: 0.25 })
  assert.deepEqual(
    refreshes.map((alpha) => [alpha?.from, alpha?.to]),
    [['mask', 'mask']],
  )
  api.setMaterial('1', { roughness: 0.5 })
  assert.equal(refreshes.at(-1), undefined)
  assert.equal(api.material('1').alphaCutoff, 0.25)
})

test('an unknown alpha mode is refused by name, nothing written', async () => {
  const { api, floor, refreshes } = await scene(() => undefined)
  const version = floor[0].version
  assert.throws(
    () => api.setMaterial('0', { alphaMode: 'MASK' as never }),
    (error: { code?: string }) => error.code === 'INVALID_MATERIAL',
  )
  assert.equal(floor[0].version, version)
  assert.equal(refreshes.length, 0)
})
