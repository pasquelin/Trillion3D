// A created material given to a drawable: worn in the variant its geometry asks for, the
// class its meshes leave taken over all of them, and what an engine lays out at open refused by
// name before any write.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../host/graph/graph.fixture.ts'
import { meshes } from '../../scene/meshes.ts'
import { refusal, scene } from './materialApi.fixture.ts'
import type { AlphaChange, SurfaceAssignment } from '../../placement/engineSceneUpdates.ts'

test('a created material is worn by the drawable it is assigned to, every engine told', async () => {
  const { api, source, refreshes } = await scene()
  const made = api.createMaterial({ baseColor: [0, 0, 1] })
  const drawable = meshes(source)[1],
    floor = api.material('0')
  assert.equal(api.assignMaterial('1/0', made.id), true, 'every engine took it')
  assert.deepEqual(
    (refreshes.at(-1) as SurfaceAssignment).meshes,
    new Map([[drawable, drawable.material]]),
    'the drawable alone wears it',
  )
  assert.deepEqual(api.material('0'), floor, 'the material it wore is left as it was')
  assert.equal(api.setMaterial(made.id, { roughness: 0.25 }), true, 'then set as any other')
  assert.equal(refreshes.length, 2, 'worn now: the change reaches the engines')
})

test('a vertex-coloured drawable wears the coloured variant of a created material, written with it', async () => {
  const { api, source } = await scene()
  const drawable = meshes(source)[2]
  drawable.geometry.setAttribute('color', new G.BufferAttribute(new Float32Array(3), 3))
  const made = api.createMaterial({ baseColor: [0, 0, 1] })
  assert.equal(api.assignMaterial('2/0', made.id), true)
  const worn = drawable.material as G.GraphSurface
  assert.equal(worn.vertexColors, true, 'its colours kept, as the open kept them')
  api.setMaterial(made.id, { baseColor: [0, 1, 0] })
  const { r, g, b } = worn.color as G.Color
  assert.deepEqual([r, g, b], [0, 1, 0], 'no stale copy')
})

test('a drawable whose meshes wear several classes is asked about the one that moves', async () => {
  const asked: AlphaChange[] = []
  const { api, associations, source } = await scene((alpha) => void asked.push(alpha))
  // The glass mesh, blended, names the floor's primitive too: an opaque material unblends it.
  associations.set(meshes(source)[5], { meshes: 0 })
  api.assignMaterial('0/0', api.createMaterial().id)
  assert.deepEqual([asked[0].from, asked[0].to], ['blend', 'opaque'])
})

test('a created material its drawables left is written alone again', async () => {
  const { api, refreshes } = await scene()
  const first = api.createMaterial().id,
    second = api.createMaterial().id
  api.assignMaterial('1/0', first)
  api.assignMaterial('1/0', second)
  const told = refreshes.length
  // Worn by nothing: WebGPU's blended layout is not asked, no engine told.
  assert.equal(api.setMaterial(first, { alphaMode: 'blend', opacity: 0.5 }), true)
  assert.equal(refreshes.length, told)
})

test('an assignment is refused by name before any write, and builds nothing', async () => {
  const { api, refreshes, source } = await scene()
  const blended = api.createMaterial({ alphaMode: 'blend', opacity: 0.5 }).id,
    opaque = api.createMaterial().id
  const worn = meshes(source).map((mesh) => mesh.material)
  // WebGPU lays its blended clusters out at open: none enters, none takes another surface.
  assert.throws(() => api.assignMaterial('0/0', blended), refusal('MATERIAL_CLASS_CHANGE'))
  assert.throws(() => api.assignMaterial('5/0', opaque), refusal('MATERIAL_CLASS_CHANGE'))
  assert.throws(() => api.assignMaterial('0/0', '0'), refusal('UNKNOWN_MATERIAL'))
  assert.throws(() => api.assignMaterial('9/0', opaque), refusal('UNKNOWN_SCENE_NODE'))
  assert.deepEqual(
    meshes(source).map((mesh) => mesh.material),
    worn,
    'no drawable wears another',
  )
  api.setMaterial(opaque, { alphaMode: 'mask' })
  assert.equal(refreshes.length, 0, 'worn by nothing still: no engine told, no variant built')
  assert.equal(api.material(opaque).alphaMode, 'mask')
})
