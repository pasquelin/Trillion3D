import type { VehicleDriver } from '../../../../sdk-core/src/physics/vehicle.ts'
import type { CharacterBodyFactory } from '../../../../sdk-core/src/collision/characterSettings.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'

/** Where the character's body comes from while the world's physics runs: `body()` is `null`
 *  when it is off, and `watch` is told each time that changes. */
export interface CharacterSource {
  body(): CharacterBodyFactory | null
  watch(listener: () => void): void
}

/** `NO_VEHICLE`: the `'vehicle'` controls asked for, or kept, without a vehicle to drive. */
export const noVehicle = () =>
  new EngineError(
    'NO_VEHICLE',
    "world.controls: 'vehicle' drives world.controls.vehicle, which is null — set it first.",
  )

/**
 * What the steered controllers of `world.controls` act on, kept by the handle across every
 * controller `kind` makes: the world's physics, the character's body, the vehicle the vehicle
 * controls drive. `bind` hands them to the controller in place, where it has them;
 * `changed` runs after a write, for the handle to bind and redraw; `driving()` says whether the
 * `'vehicle'` controls are in place, so the vehicle cannot be taken from under them.
 */
export function controlTargets(
  physics: CharacterSource | null,
  changed: () => void,
  driving: () => boolean,
) {
  let vehicle: VehicleDriver | null = null
  const accessors = {
    /**
     * Vehicle only: what the `'vehicle'` controls drive — anything with `drive(input)`, which
     * hears the throttle, brake, steer and handbrake each time the keys change them. `null` by
     * default; the `'vehicle'` controls never run without one: `kind = 'vehicle'` and
     * `createWorld(…, { controls: 'vehicle' })` throw `NO_VEHICLE` while it is `null`, and so
     * does setting it to `null` while they drive.
     */
    get vehicle(): VehicleDriver | null {
      return vehicle
    },
    set vehicle(next: VehicleDriver | null) {
      if (!next && driving()) throw noVehicle()
      vehicle = next
      changed()
    },
  }
  return {
    accessors,
    bind(live: Record<string, unknown> | null) {
      if (!live) return
      if ('vehicle' in live && live.vehicle !== vehicle) live.vehicle = vehicle
      if (!('physics' in live)) return
      const body = physics?.body() ?? null
      if (live.physics !== body) live.physics = body
    },
  }
}
