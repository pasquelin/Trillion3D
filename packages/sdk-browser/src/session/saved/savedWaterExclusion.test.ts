import test from 'node:test'
import assert from 'node:assert/strict'
import { Scene } from '../world/scene.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import {
  WaterExclusionVolume,
  waterExclusionVolumesOf,
} from '../../../../sdk-core/src/world/object/waterExclusionVolume.ts'

const noModel = () => new Scene(() => Promise.reject(new Error('no model here')))

test('a water exclusion volume is a box of its scale: faces in, beyond out, turned with its node', () => {
  const v = object.waterExclusion()
  v.scale.set(4, 2, 6)
  v.position.set(1, 2, 3)
  assert.equal(v.encompasses(3, 3, 6), true)
  assert.equal(v.encompasses(3.01, 2, 3), false)
  const bounds = v.worldBounds(new Float64Array(6))
  assert.deepEqual([...bounds], [-1, 1, 0, 3, 3, 6])
  assert.equal(v.excludes(undefined), true, 'by default every body is excluded')
})

test('a volume is known to the world it enters and forgotten when it leaves', () => {
  const scene = noModel()
  scene._link = { pose() {}, structure() {}, content() {}, posed() {} }
  const v = object.waterExclusion()
  scene.add(v)
  assert.ok(waterExclusionVolumesOf(v)?.has(v))
  scene.remove(v)
  assert.equal(waterExclusionVolumesOf(v)?.has(v) ?? false, false)
})

test('a copy and a saved scene keep the volume: its box, its mode and the bodies it names', async () => {
  const scene = noModel()
  const lake = object.mesh(geometry.box(1, 1, 1)),
    sea = object.mesh(geometry.box(1, 1, 1))
  const v = object.waterExclusion('onlyListed', [sea])
  v.scale.set(2, 3, 4)
  v.position.set(5, 6, 7)
  scene.add(lake, sea, v)
  const copy = object.clone(v)!
  assert.ok(copy instanceof WaterExclusionVolume)
  assert.equal(copy.mode, 'onlyListed')
  assert.deepEqual(copy.bodies, [sea])
  assert.deepEqual(copy.scale.toArray(), [2, 3, 4])
  const again = noModel()
  await again.fromJSON(JSON.parse(JSON.stringify(scene.toJSON())))
  const [lake2, sea2, v2] = again.children as [unknown, unknown, WaterExclusionVolume]
  assert.ok(v2 instanceof WaterExclusionVolume)
  assert.equal(v2.mode, 'onlyListed')
  assert.deepEqual(v2.bodies, [sea2])
  assert.notEqual(lake2, sea2)
  assert.deepEqual(v2.position.toArray(), [5, 6, 7])
})

test('a copy of a subtree names the copies of the bodies it holds, and the original of one outside it', () => {
  const scene = noModel()
  const group = object.group(),
    pool = object.mesh(geometry.box(1, 1, 1)),
    outside = object.mesh(geometry.box(1, 1, 1))
  const v = object.waterExclusion('onlyListed', [pool, outside])
  group.add(pool, v)
  scene.add(group, outside)
  const copy = object.clone(group)!
  const [pool2, v2] = copy.children as [unknown, WaterExclusionVolume]
  assert.deepEqual(v2.bodies, [pool2, outside])
  assert.deepEqual(v.bodies, [pool, outside], 'the original is untouched')
})

test("a volume tests a point against the pose it has now, not the last image's", () => {
  const scene = noModel()
  scene._link = { pose() {}, structure() {}, content() {}, posed() {} }
  const v = object.waterExclusion()
  scene.add(v)
  assert.equal(v.encompasses(10, 0, 0), false)
  v.position.set(10, 0, 0)
  assert.equal(v.encompasses(10, 0, 0), true)
})

test('a body outside the saved tree keeps its place in the list, and a mesh keeps its water body', async () => {
  const scene = noModel()
  const lake = object.mesh(geometry.box(1, 1, 1)),
    away = object.mesh(geometry.box(1, 1, 1))
  lake.waterBody = { overlapPriority: 2, depth: 5, underwaterPostProcess: false }
  const v = object.waterExclusion('onlyListed', [away, lake])
  scene.add(lake, v)
  const saved = JSON.parse(JSON.stringify(scene.toJSON()))
  const again = noModel()
  await again.fromJSON(saved)
  const [lake2, v2] = again.children as [typeof lake, WaterExclusionVolume]
  assert.equal(v2.bodies.length, 2, 'no body is dropped')
  assert.equal(v2.bodies[1], lake2)
  assert.notEqual(v2.bodies[0], away)
  assert.deepEqual(lake2.waterBody, lake.waterBody)
  const copy = object.clone(lake)!
  copy.waterBody!.depth = 1
  assert.equal(lake.waterBody!.depth, 5, 'a copy has a body of its own')
})
