import {
  BODY_INDEX,
  VEHICLE_STATE_WORDS,
  WHEEL_STATE_WORDS,
  writeDrive,
  writeUnvehicle,
  writeVehicle,
  type CommandWriter,
  type Vehicle,
} from '../../../sdk-core/src/physics/index.ts'
import { slerpArc } from '../../../sdk-core/src/math/matrix/quaternion.ts'
import { Quaternion } from '../../../sdk-core/src/world/math/quaternion.ts'
import type { Vector3 } from '../../../sdk-core/src/world/math/vector3.ts'
import type { createPhysicsBodies } from './bodies.ts'
import { createSimulatedIds, engineIdOf } from './simulatedIds.ts'
import { interpolateAll, landAll } from './drawnPoses.ts'
import type { TickRecords } from './protocol.ts'
import { createTwoSteps, eachRecord } from './twoSteps.ts'

/** Each wheel's pose as the page placed it, given back when the vehicle leaves the simulation. */
type Rest = { position: Vector3; quaternion: Quaternion }[]

/** A made vehicle: its body's engine id, its wheels at rest, and its wheels' two states
 *  (`twoSteps.ts`, 7 numbers a wheel) with the arc between their turns (`slerpArc`, 3 a wheel). */
type Made = {
  vehicle: Vehicle
  body: number
  rest: Rest
  from: Float32Array
  to: Float32Array
  arcs: Float64Array
}

/** A wheel's turn as the worker sent it: composed with its rest in one write, an unchanged one
 *  notifies nobody. */
const turned = new Quaternion()
/** The wheels drawn, every one listed (`interpolateAll`), grown to the most a vehicle has. */
let wheels = new Int32Array(0),
  position = new Float64Array(0),
  quaternion = new Float64Array(0)

/**
 * The vehicles of a session: which are made in the simulation, under which id (a slot and its
 * generation). A vehicle is made once its body is simulated, and taken out when the body leaves
 * or is rebuilt, or the vehicle is removed. Its speed, engine and gear are read from each tick's
 * state; its wheels are drawn at the bodies' time between their two states (`twoSteps.ts`), a
 * wheel's place on their line and its turn on their arc, as a body is (`interpolateAll`).
 */
export function createPhysicsVehicles(
  writer: CommandWriter,
  bodies: ReturnType<typeof createPhysicsBodies>,
  invalidate: () => void,
) {
  const made = new Map<Vehicle, Made>()
  const ids = createSimulatedIds<Vehicle>()
  /** The vehicles on their way, by their id's slot (fewer than the bodies, each needing one), and
   *  the vehicle drawn under each. */
  const steps2 = createTwoSteps(bodies.generation.length)
  const byKey: (Made | undefined)[] = []
  /** Draws the wheels of the vehicle under `key` at `t` of its step. */
  const draw = (key: number, t: number) => {
    const { vehicle, rest, from, to, arcs } = byKey[key]!,
      count = rest.length,
      s = vehicle.body.scale
    if (wheels.length < count) {
      wheels = Int32Array.from({ length: count }, (_, i) => i)
      ;[position, quaternion] = [new Float64Array(count * 3), new Float64Array(count * 4)]
    }
    if (t === 1) landAll(wheels, count, to, position, quaternion)
    else interpolateAll(wheels, count, from, to, arcs, t, position, quaternion)
    for (let i = 0; i < count; i++) {
      const p = i * 3,
        q = i * 4
      vehicle.wheels[i].position.set(
        position[p] / s.x,
        position[p + 1] / s.y,
        position[p + 2] / s.z,
      )
      turned.set(quaternion[q], quaternion[q + 1], quaternion[q + 2], quaternion[q + 3])
      vehicle.wheels[i].quaternion.multiplyQuaternions(turned, rest[i].quaternion)
    }
  }
  const host: NonNullable<Vehicle['_host']> = {
    drive(vehicle) {
      writeDrive(writer, vehicle._id, vehicle)
      invalidate()
    },
  }
  const drop = (vehicle: Vehicle) => {
    writeUnvehicle(writer, vehicle._id)
    ids.release(vehicle._id)
    byKey[vehicle._id & BODY_INDEX] = undefined
    made.get(vehicle)!.rest.forEach(({ position, quaternion }, i) => {
      vehicle.wheels[i].position.copy(position)
      vehicle.wheels[i].quaternion.copy(quaternion)
    })
    made.delete(vehicle)
    vehicle._state(0, 0, 0)
    vehicle._host = null
    vehicle._id = -1
  }
  const connect = (vehicle: Vehicle) => {
    const body = engineIdOf(bodies, vehicle.body)
    if (body < 0 || vehicle._host) return
    const id = ids.take(vehicle)
    writeVehicle(writer, id, body, vehicle)
    writeDrive(writer, id, vehicle)
    const rest = vehicle.wheels.map((w) => ({
      position: w.position.clone(),
      quaternion: w.quaternion.clone(),
    }))
    const count = rest.length
    const [from, to] = [new Float32Array(count * 7), new Float32Array(count * 7)]
    made.set(vehicle, { vehicle, body, rest, from, to, arcs: new Float64Array(count * 3) })
    vehicle._host = host
    vehicle._id = id
  }
  return {
    /** Brings the made vehicles in line with `vehicles` and with the bodies, after the bodies. */
    reconcile(vehicles: ReadonlySet<Vehicle>) {
      for (const [vehicle, { body }] of made)
        if (!vehicles.has(vehicle) || engineIdOf(bodies, vehicle.body) !== body) drop(vehicle)
      for (const vehicle of vehicles) if (!made.has(vehicle)) connect(vehicle)
    },
    /** A tick's vehicle states, after `steps` fixed steps: speed, engine and gear read, each
     *  wheel's two states kept. */
    receive(records: TickRecords | null, steps: number) {
      steps2.begin(steps)
      if (records)
        eachRecord(records, VEHICLE_STATE_WORDS, WHEEL_STATE_WORDS, (id, newest, before, f) => {
          const live = ids.of(id),
            own = live && made.get(live)
          if (!own) return
          live._state(f[2], f[3], f[4])
          const key = id & BODY_INDEX
          if (!steps2.record(key, own, newest, before, byKey[key] !== own)) return
          byKey[key] = own
          for (let i = 0; i < own.rest.length; i++)
            slerpArc(own.arcs, i * 3, own.from, i * 7 + 3, own.to, i * 7 + 3)
        })
      steps2.end((key) => byKey[key] && draw(key, 1))
    },
    /** Draws every moving vehicle's wheels at `t` of their step (`along`), `waiting` while the
     *  page waits for the worker's next state; whether any is still on its way. */
    apply(t: number, waiting: boolean) {
      if (!steps2.count) return false
      steps2.keep((key) => byKey[key] !== undefined)
      for (let i = 0; i < steps2.count; i++) draw(steps2.moving[i], t)
      return steps2.settle(t, waiting)
    },
    clear() {
      for (const vehicle of [...made.keys()]) drop(vehicle)
    },
  }
}
