import test, { type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import type { Vehicle } from '../../../sdk-core/src/physics/index.ts'
import { box } from '../../../sdk-core/src/world/geometry/basic.ts'
import { Material } from '../../../sdk-core/src/world/material/material.ts'
import { Mesh } from '../../../sdk-core/src/world/object/mesh.ts'
import { jointRig, type Rig } from './joints.fixture.ts'
import { flatRig, placeVehicle, RELEASED } from './vehicles.fixture.ts'

/** Steps `rig` one step at a time for `steps`: whether each step brought `vehicle` a state. */
function writes(t: TestContext, rig: Rig, vehicle: Vehicle, steps: number) {
  const heard = t.mock.method(vehicle, '_state')
  const out = Array.from({ length: steps }, () => {
    const before = heard.mock.callCount()
    rig.run(1)
    return heard.mock.callCount() > before
  })
  heard.mock.restore()
  return out
}

test('a parked vehicle writes its state twice as it rests, then nothing until it moves again', async (t) => {
  const rig = await flatRig()
  const car = placeVehicle(rig, 'car')
  const settle = writes(t, rig, car.vehicle, 600)
  const quiet = settle.lastIndexOf(true) + 1
  assert.ok(quiet > 0 && quiet < 600, `it comes to rest: last write at step ${quiet}`)
  assert.deepEqual(settle.slice(quiet), Array(600 - quiet).fill(false), 'at rest, nothing written')
  // Driven, it writes every step again; released and at rest, it goes quiet again.
  car.vehicle.drive({ ...RELEASED, throttle: 0.5 })
  assert.ok(writes(t, rig, car.vehicle, 30).every(Boolean), 'driven, every step writes')
  assert.ok(car.vehicle.speed > 0.5, `and the page hears it move: ${car.vehicle.speed} m/s`)
  // Held by the handbrake to a stop, then released: a brake held keeps a vehicle awake.
  car.vehicle.drive({ ...RELEASED, handbrake: true })
  for (let s = 0; s < 1200 && Math.abs(car.vehicle.speed) > 0.01; s += 60)
    assert.ok(writes(t, rig, car.vehicle, 60).every(Boolean), 'braked, awake')
  car.vehicle.drive(RELEASED)
  const stop = writes(t, rig, car.vehicle, 900)
  assert.equal(stop.at(-1), false, 'stopped and released, quiet again')
  assert.ok(
    car.wheels[0].position.toArray().every(Number.isFinite),
    'its wheels kept where they rested',
  )
})

test('a parked vehicle something falls on wakes and writes again', async (t) => {
  const rig = await flatRig()
  const car = placeVehicle(rig, 'car')
  assert.equal(writes(t, rig, car.vehicle, 600).at(-1), false, 'parked')
  const y = rig.at(car.body)[1]
  rig.cube(0, 3, 0)
  const hit = writes(t, rig, car.vehicle, 120)
  assert.ok(hit.some(Boolean), 'the impact wakes it: its state is written again')
  const after = rig.at(car.body)[1]
  assert.ok(Number.isFinite(after) && after < y + 0.5, 'still on its wheels')
})

test('a vehicle parked on a slope holds its brakes, stays where it stopped and goes quiet (#831)', async (t) => {
  // A valley's floor is never flat: released, every kind used to creep down it for good, so its
  // body and wheels moved every step and every shadow page they cover was drawn again.
  const slope = (8 * Math.PI) / 180
  for (const kind of ['car', 'motorcycle', 'tracked'] as const) {
    const rig = await jointRig()
    const ground = new Mesh(box(200, 1, 200), new Material('meshStandard', { physics: 'stone' }))
    ground.position.set(0, -0.5, 0)
    ground.rotation.x = slope
    ground.physics = 'static'
    rig.scene.add(ground)
    const parked = placeVehicle(rig, kind, {}, [0, 0.3, 0])
    parked.body.rotation.x = slope
    const settle = writes(t, rig, parked.vehicle, 300)
    const at = rig.at(parked.body)
    assert.equal(settle.at(-1), false, `${kind}: at rest, nothing written`)
    rig.run(600)
    const crept = Math.hypot(...rig.at(parked.body).map((v, i) => v - at[i]))
    assert.ok(crept < 1e-3, `${kind}: held where it stopped, crept ${crept} m`)
  }
})

test('a vehicle parked on a slope drives off when the throttle is pressed (#831)', async (t) => {
  // The parked brake holds only while the pedals rest: the throttle releases it in the step it
  // reaches the vehicle, so a parked car drives off instead of standing in gear at 0 km/h.
  const slope = (8 * Math.PI) / 180
  const rig = await jointRig()
  const ground = new Mesh(box(200, 1, 200), new Material('meshStandard', { physics: 'stone' }))
  ground.position.set(0, -0.5, 0)
  ground.rotation.x = slope
  ground.physics = 'static'
  rig.scene.add(ground)
  const car = placeVehicle(rig, 'car', {}, [0, 0.3, 0])
  car.body.rotation.x = slope
  assert.equal(writes(t, rig, car.vehicle, 300).at(-1), false, 'parked, at rest')
  const at = rig.at(car.body)
  car.vehicle.drive({ ...RELEASED, throttle: 1 })
  rig.run(120)
  const moved = Math.hypot(...rig.at(car.body).map((v, i) => v - at[i]))
  assert.ok(car.vehicle.speed > 1, `driving: ${car.vehicle.speed} m/s`)
  assert.ok(moved > 1, `it left its place: ${moved} m`)
})
