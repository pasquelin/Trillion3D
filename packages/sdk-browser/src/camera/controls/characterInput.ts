import { ADVANCE_ARROW_KEYS, axisOf, STRAFE_ARROW_KEYS, trackKeys } from './input.ts'
import { createRestingBody } from './restingBody.ts'
import { yawWalk } from './math.ts'
import { length3 } from '../../../../math/src/vector/vector.ts'
import type {
  CharacterBody,
  CharacterBodyFactory,
} from '../../../../sdk-core/src/collision/characterSettings.ts'
import type { CharacterMode } from '../../../../sdk-core/src/collision/characterModes.ts'
import type { CharacterCameraControls } from './characterControls.ts'
import type { ControlBase } from './base.ts'

const JUMP = 'Space',
  CROUCH = ['KeyC']

/** The body the controls drive, and the factory that made it (`null`: the resting one). */
export type BodySlot = { body: CharacterBody; physics: CharacterBodyFactory | null }

/** The keys the character reads. */
export type CharacterKeys = ReturnType<typeof trackKeys>

/** A slot holding the resting body, standing where it is. */
export const createBodySlot = (): BodySlot => ({ body: createRestingBody(), physics: null })

/** The body's input from the keys held: the wish along the head's yaw and the jump and crouch keys. */
export function readInput(
  input: { wishX: number; wishY: number; wishZ: number; jump: boolean; crouch: boolean },
  wish: Float64Array,
  keys: CharacterKeys,
  orientation: Float64Array,
  mode: CharacterMode | undefined,
  yaw: number,
) {
  const strafe = axisOf(keys, ...STRAFE_ARROW_KEYS),
    advance = axisOf(keys, ...ADVANCE_ARROW_KEYS)
  yawWalk(wish, yaw, strafe, advance)
  input.wishX = wish[0]
  input.wishZ = wish[1]
  input.wishY = 0
  input.jump = keys.has(JUMP)
  input.crouch = CROUCH.some((code) => keys.has(code))
  if (mode === 'swimming' || mode === 'flying') {
    // In a fluid the body goes where the head looks: the wish takes the pitch, Space rises, the crouch key sinks.
    const [x, y, z, w] = orientation
    input.wishY = advance * 2 * (w * x - y * z) + (keys.has(JUMP) ? 1 : 0) - (input.crouch ? 1 : 0)
    const size = length3(input.wishX, input.wishY, input.wishZ)
    if (size > 1) {
      input.wishX /= size
      input.wishY /= size
      input.wishZ /= size
    }
  }
}

/**
 * `physics`, kept off the public type: what makes the body of the world's physics, when it
 * runs (`world.controls` hands it over) — Jolt's virtual character in the physics worker, which
 * meets every body of the simulation; `null` leaves the body standing where it is. The body
 * keeps its place across the switch.
 */
export function definePhysics(api: CharacterCameraControls, slot: BodySlot) {
  Object.defineProperty(api, 'physics', {
    get: () => slot.physics,
    set(next: CharacterBodyFactory | null) {
      if (next === slot.physics) return
      const [x, y, z] = slot.body.feet
      slot.body.dispose?.()
      slot.physics = next
      slot.body = next ? next(api) : createRestingBody()
      slot.body.place(x, y, z)
    },
  })
}

/** Tracks the keys the character uses; a press of Space is the body's jump press. */
export function trackCharacterKeys(surface: HTMLElement, base: ControlBase, slot: BodySlot) {
  let jumpHeld = false
  const keys: CharacterKeys = trackKeys(
    surface,
    base,
    () => {
      if (keys.has(JUMP) && !jumpHeld) slot.body.pressJump()
      jumpHeld = keys.has(JUMP)
      base.emit()
    },
    [STRAFE_ARROW_KEYS, ADVANCE_ARROW_KEYS, [JUMP], CROUCH],
  )
  return keys
}
