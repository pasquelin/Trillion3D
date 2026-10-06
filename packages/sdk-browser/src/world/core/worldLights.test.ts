import test from 'node:test'
import assert from 'node:assert/strict'
import { light } from '../../../../sdk-core/src/world/light/light.ts'
import { object } from '../../../../sdk-core/src/world/object/index.ts'
import { geometry } from '../../../../sdk-core/src/world/geometry/index.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import {
  boxReads,
  childReads,
  lightChecks,
  lightStore,
  walkedLights,
  wiredLights,
} from './worldLights.fixture.ts'

const box = geometry.box(1, 1, 1)
/** A group of `count` meshes, none of them a light. */
const crowd = (count: number) => {
  const group = object.group()
  for (let i = 0; i < count; i++) group.add(object.mesh(box))
  return group
}
/** Every node under `root`, itself included. */
const under = (root: Object3D) => {
  const nodes = new Set<object>()
  root.traverse((node) => nodes.add(node))
  return nodes
}

/** A sun, a car of 100 parts holding a lamp, and 100 parked meshes: lit once. */
function street(lamp = light.point({ intensity: 5, distance: 8 })) {
  const { scene, lights, calls } = wiredLights()
  const sun = light.directional({ intensity: 3 }),
    car = crowd(100),
    parked = crowd(100)
  car.add(lamp)
  scene.add(sun, car, parked)
  const api = lightStore()
  lights.sync(api)
  return { scene, lights, calls, car, parked, lamp, api }
}

test('a light under a hidden group lights nothing, and lights again once shown', () => {
  const { scene, lights } = wiredLights()
  const group = object.group()
  group.add(light.point({ intensity: 5 }), light.ambient({ intensity: 1 }))
  scene.add(group)
  const api = lightStore()
  assert.ok(lights.sync(api))
  assert.equal(api.held.size, 1)
  group.visible = false
  assert.equal(lights.sync(api), undefined, 'the ambient gives nothing')
  assert.equal(api.held.size, 0, 'the lamp left the store')
  assert.equal(lights.held, 2, 'both are still held, so showing the group relights')
  group.visible = true
  assert.ok(lights.sync(api))
  assert.equal(api.held.size, 1)
})

test('moving a node asks nothing of what hangs under it', () => {
  const { car, parked, calls } = street()
  const moved = lightChecks(() => car.position.set(1, 2, 3))
  assert.ok(calls.relight > 0 && !calls.invalidate, 'the car holds the lamp: it relights')
  const still = lightChecks(() => parked.position.set(4, 5, 6))
  assert.ok(calls.invalidate > 0, 'the parked group holds none: a frame, no relight')
  // The link asks of the written node alone whether it is a bare lamp (its extent): one per write.
  assert.equal(moved + still, calls.relight + calls.invalidate, 'no subtree of 101 nodes walked')
})

test('a light sync reads the lights through the nodes holding them, never the scene', () => {
  const { scene, lights, car, api } = street()
  car.position.x = 1
  const parts = under(car)
  const reads = childReads(
    () => lights.sync(api),
    (node) => node === scene || parts.has(node),
  )
  assert.equal(reads, 0, 'no children list is read: the holders keep theirs')
  const checks = lightChecks(() => lights.sync(api))
  assert.equal(
    checks,
    3,
    'the sun, the car and its lamp: the scene’s 202 other nodes are not asked',
  )
})

test('a lamp the page bounded never measures the scene; an unbounded one, once per change', () => {
  const bounded = street()
  bounded.car.position.x = 1
  assert.equal(
    boxReads(() => bounded.lights.sync(bounded.api)),
    0,
    'its own range: no extent read',
  )
  const open = street(light.point({ intensity: 5 }))
  open.car.position.x = 1
  assert.equal(
    boxReads(() => open.lights.sync(open.api)),
    200,
    'the car moved: the extent is read',
  )
  assert.equal(
    boxReads(() => open.lights.sync(open.api)),
    0,
    'nothing moved since: it is kept',
  )
})

test('a change of structure has the next sync walk the scene once; the ones after walk none', () => {
  const { scene, lights, parked, api } = street()
  parked.add(object.mesh(box))
  const nodes = under(scene)
  const reads = () =>
    childReads(
      () => lights.sync(api),
      (node) => nodes.has(node),
    )
  assert.equal(reads(), nodes.size, 'every node’s children read once')
  assert.equal(reads(), 0, 'the structure stands: the holders are read alone')
})

test('a pose written after a change of structure is judged on the scene as it stands', () => {
  const { scene, lights, calls, car, parked, lamp } = street()
  scene.add(object.mesh(box))
  parked.add(lamp) // the lamp moves from the car to the parked group
  car.position.x = 1
  assert.equal(calls.relight, 0, 'the car no longer holds it')
  parked.position.x = 1
  assert.equal(calls.relight, 1, 'the parked group does')
  lights.sync(lightStore())
  car.position.x = 2
  parked.position.x = 2
  assert.equal(calls.relight, 2, 'and the holders the next sync read say the same')
})

/** A sync of the index and of a walk of the whole scene after `edit`: the same store and sum. */
function sameAfter(edit: (scene: Object3D, kept: Object3D) => void) {
  const { scene, lights } = wiredLights()
  const walked = walkedLights(scene)
  const [indexed, reference] = [lightStore(), lightStore()]
  const kept = object.group()
  for (let i = 1; i <= 3; i++) {
    const holder = object.group()
    holder.add(light.ambient({ intensity: i }), light.point({ intensity: i, distance: i }))
    kept.add(holder)
  }
  scene.add(kept, light.directional({ intensity: 1 }))
  lights.sync(indexed)
  walked.sync(reference)
  edit(scene, kept)
  assert.deepEqual(lights.sync(indexed), walked.sync(reference), 'the irradiance, to the bit')
  assert.deepEqual([...indexed.held], [...reference.held], 'the store')
  assert.deepEqual(indexed.added, reference.added, 'the order lamps were added in')
}

test('a node edited off the scene is read as it comes back', () => {
  sameAfter((scene, kept) => {
    scene.remove(kept)
    kept.children[0].add(light.point({ intensity: 7 }))
    scene.add(kept)
  })
  sameAfter((scene, kept) => {
    scene.remove(kept)
    kept.add(kept.children[0]) // reordered while nobody hears it
    scene.add(kept)
  })
})

test('a destroyed lamp leaves the store, and no later write reads it', () => {
  const { scene, lights, calls, car, lamp, api } = street()
  lamp.destroy()
  car.position.x = 1
  assert.equal(calls.relight, 0, 'the car holds no lamp now')
  lights.sync(api)
  assert.deepEqual([...api.held.keys()], ['world-light-1'], 'the sun alone')
  car.add(light.point({ intensity: 1 }))
  car.destroy()
  scene.position.x = 1
  lights.sync(api)
  assert.deepEqual([...api.held.keys()], ['world-light-1'])
})

test('lights moved ahead of others add up in the scene’s new order, to the bit', () => {
  const { scene, lights } = wiredLights()
  const walked = walkedLights(scene)
  const [a, b] = [object.group(), object.group()]
  a.add(light.ambient({ intensity: 1 }))
  b.add(light.ambient({ intensity: 1e-16 }))
  scene.add(a, b, light.ambient({ intensity: 1e-16 }))
  const before = [...lights.sync(lightStore())!] // the coefficients are the next sync's
  assert.deepEqual(before, walked.sync(lightStore()))
  scene.add(a) // `a` moves behind the others: its ambient is now added last
  const after = lights.sync(lightStore())
  assert.deepEqual(after, walked.sync(lightStore()), 'the order a walk adds them in')
  assert.notDeepEqual(after, before, 'the order shows: (1 + ε) + ε is 1, (ε + ε) + 1 is not')
})
