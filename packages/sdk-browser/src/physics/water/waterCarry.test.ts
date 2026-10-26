// The meshes that hold the world's water (`waterCarry.ts`): the page links a mesh to the world's
// surface (`mesh.waves = world.physics.waterSurface`); nothing is guessed from a mesh's place. A
// mesh holding the surface is told when the water set again changes its wave count, and the page's
// own waves, `null` among them, and a body are never touched.
import { HALF_PI } from '../../../../math/src/constants.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { box, plane } from '../../../../sdk-core/src/world/geometry/basic.ts'
import { Camera } from '../../../../sdk-core/src/world/camera/camera.ts'
import { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts'
import { Group, type Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import { WaterSurface } from '../../../../sdk-core/src/fluids/waterSurface.ts'
import type { WaveSpec } from '../../../../sdk-core/src/fluids/waves.ts'
import { createWorldPhysics } from '../worldPhysics.ts'
import { createWaterCarry } from './waterCarry.ts'

const SWELL: readonly [WaveSpec] = [
  { direction: [1, 0.35], wavelength: 11, amplitude: 0.42, steepness: 0.3 },
]
const water = (level: number, waves: readonly WaveSpec[] = SWELL) => ({
  level,
  waves: waves.map((w) => ({ ...w })),
})

/** A world's scene and physics, the content changes the world was told counted by mesh. */
function world() {
  const told = new Map<Object3D, number>()
  const root = new Group()
  root._link = {
    pose() {},
    posed() {},
    structure() {},
    content: (node) => void told.set(node, (told.get(node) ?? 0) + 1),
  }
  const physics = createWorldPhysics(
    { invalidate() {}, explorer: null },
    root,
    () => new Camera('perspective'),
  )
  return { root, physics, told }
}
/** A 28 × 20 m sheet laid flat at `y` by a quarter turn, as a page lays a plane. */
const sheet = (y: number) => {
  const mesh = new Mesh(plane(28, 20, 4, 4), new Material('meshStandard'))
  mesh.rotation.x = -HALF_PI
  mesh.position.y = y
  return mesh
}

test('a sheet at the level is no surface until the page links it; nothing is written to a mesh', () => {
  const { root, physics, told } = world()
  const linked = sheet(2.4),
    unlinked = sheet(2.4),
    crate = new Mesh(box(1, 1, 1), new Material('meshStandard')),
    own = sheet(2.4),
    none = sheet(2.4)
  crate.position.y = 2.4
  crate.physics = 'dynamic'
  const theirs = new WaterSurface(water(2.4))
  own.waves = theirs
  none.waves = null
  root.add(linked, unlinked, crate, own, none)
  physics.handle.water = water(2.4)
  const surface = physics.handle.waterSurface!
  linked.waves = surface
  assert.equal(physics.frame(), false)
  assert.equal(unlinked.waves, undefined, 'a sheet on the level is not water by its place')
  assert.equal(crate.waves, undefined, 'a body is a body')
  assert.equal(own.waves, theirs, "the page's waves are its own")
  assert.equal(none.waves, null, '`null` is never written over')
  // Set again, the water is the same surface: what holds it is told the new wave count.
  physics.handle.water = water(2.4, [...SWELL, { ...SWELL[0], wavelength: 4 }])
  assert.equal(physics.handle.waterSurface, surface)
  const before = told.get(linked) ?? 0
  physics.frame()
  assert.equal(surface.waveModel.count, 2)
  assert.equal(told.get(linked), before + 1, 'a wave more resizes its record: told again')
  assert.equal(told.get(unlinked), undefined, 'a mesh that holds nothing is told nothing')
  assert.equal(linked.waves, surface, 'and keeps its own waves')
})

test('without water no holder asks a frame; a count outlives the frames without water', () => {
  const { root, told } = world()
  const carry = createWaterCarry(root)
  const surface = new WaterSurface(water(0))
  const bound = sheet(5)
  bound.waves = surface
  root.add(bound)
  carry.water()
  assert.equal(carry.frame(surface), true, 'a holder drawn on while the waves move')
  assert.equal(carry.frame(null), false, 'no water: no frame asked, nothing read off it')
  surface._declare(water(0, [...SWELL, { ...SWELL[0], wavelength: 4 }]))
  carry.water()
  const before = told.get(bound) ?? 0
  carry.frame(surface)
  assert.equal(told.get(bound), before + 1, 'the new count, after a frame without water')
})
