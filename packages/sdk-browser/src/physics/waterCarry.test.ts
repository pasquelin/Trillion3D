// The meshes the world's water carries (`waterCarry.ts`): a plane laid flat at the water's
// level is the water's surface, its `waves` the world's, set again in place when the water is;
// moved off the level, removed, or the water gone, it is released; the page's own waves, `null`
// among them, and a body are never touched; each change tells the world the mesh's content, and a
// mesh the page bound to the world's surface is told when the water set again changes its count.
import test from 'node:test'
import assert from 'node:assert/strict'
import { box, plane } from '../../../sdk-core/src/world/geometry/basic.ts'
import { Camera } from '../../../sdk-core/src/world/camera/camera.ts'
import { Material } from '../../../sdk-core/src/world/material/material.ts'
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
import { Group, type Object3D } from '../../../sdk-core/src/world/object/object3d.ts'
import { WaterSurface } from '../../../sdk-core/src/fluids/waterSurface.ts'
import type { WaveSpec } from '../../../sdk-core/src/fluids/waves.ts'
import { createWorldPhysics } from './worldPhysics.ts'
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
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  return mesh
}

test('a sheet laid flat at the level is carried; one off it, standing or tilted, is not', () => {
  for (const level of [0, 2.4, -3000.5]) {
    const { root, physics } = world()
    const on = sheet(level),
      off = sheet(level + 1e-3),
      standing = new Mesh(plane(28, 20), new Material('meshStandard')),
      tilted = sheet(level),
      rewritten = sheet(level)
    rewritten.geometry = rewritten.geometry.clone()
    rewritten.geometry.usage = 'dynamic'
    standing.position.y = level
    tilted.rotation.y = 1e-4
    root.add(on, off, standing, tilted, rewritten)
    physics.handle.water = water(level)
    physics.frame()
    assert.equal(on.waves, physics.handle.waterSurface, `at ${level}`)
    assert.equal(off.waves, undefined, `a millimetre off ${level}`)
    assert.equal(standing.waves, undefined, 'standing')
    assert.equal(tilted.waves, undefined, 'tilted by a tenth of a milliradian')
    assert.equal(rewritten.waves, undefined, 'a geometry the page rewrites is the page’s')
  }
})

test('the water carries the sheet at its level, set again in place, released when it leaves', () => {
  const { root, physics, told } = world()
  const sea = sheet(2.4),
    crate = new Mesh(box(1, 1, 1), new Material('meshStandard')),
    own = sheet(2.4),
    none = sheet(2.4)
  crate.position.y = 2.4
  crate.physics = 'dynamic'
  const theirs = new WaterSurface(water(2.4))
  own.waves = theirs
  none.waves = null
  root.add(sea, crate, own, none)
  assert.equal(physics.frame(), false)
  assert.equal(sea.waves, undefined, 'no water, nothing carried')
  physics.handle.water = water(2.4)
  const surface = physics.handle.waterSurface!
  // The page's own binding to the world's surface, off the level: a holder it set itself.
  const bound = sheet(5)
  bound.waves = surface
  root.add(bound)
  physics.frame()
  assert.equal(sea.waves, surface)
  assert.equal(told.get(sea), 1, 'the world is told once')
  assert.equal(own.waves, theirs, "the page's waves are its own")
  assert.equal(none.waves, null, '`null` is never carried')
  assert.equal(crate.waves, undefined, 'a body is a body')
  // Set again, the water is the same surface: what holds it is carried by the new waves.
  physics.handle.water = water(2.4, [...SWELL, { ...SWELL[0], wavelength: 4 }])
  assert.equal(physics.handle.waterSurface, surface)
  physics.frame()
  assert.equal(sea.waves, surface)
  assert.equal(surface.waveModel.count, 2)
  assert.equal(told.get(sea), 2, 'a wave more resizes its record: told again')
  assert.equal(told.get(bound), 1, "the page's holder is told the new count too")
  assert.equal(bound.waves, surface, 'and keeps its own waves')
  // Off the level, it is released; back on it, carried again.
  sea.position.y = 3
  physics.frame()
  assert.equal(sea.waves, undefined)
  sea.position.y = 2.4
  physics.frame()
  assert.equal(sea.waves, surface)
  // The page writing its own waves takes the mesh back.
  sea.waves = theirs
  physics.frame()
  sea.position.y = 3
  physics.frame()
  assert.equal(sea.waves, theirs)
  sea.waves = undefined
  sea.position.y = 2.4
  physics.frame()
  // Removed, then the water gone: released.
  root.remove(sea)
  physics.frame()
  assert.equal(sea.waves, undefined)
  root.add(sea)
  physics.frame()
  assert.equal(sea.waves, surface)
  physics.handle.water = null
  physics.frame()
  assert.equal(sea.waves, undefined)
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
  // A line at the level is no surface.
  const line = new Mesh(plane(28, 20), new Material('line'), 'lineSegments')
  line.rotation.x = -Math.PI / 2
  root.add(line)
  carry.frame(surface)
  assert.equal(line.waves, undefined)
})
