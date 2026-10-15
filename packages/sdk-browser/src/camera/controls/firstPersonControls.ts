import { createChangeGate, createControlBase } from './base.ts'
import { ADVANCE_KEYS, axisOf, STRAFE_KEYS, trackKeys, type KeyAxis } from './input.ts'
import { controlPose } from './pose.ts'
import { yawWalk } from './math.ts'
import { createHead, HEAD_DEFAULTS, headLock, type PersonHead } from './look.ts'
import type { ControlCamera, SteeredCameraControls } from './types.ts'

/**
 * FIRST PERSON, pointer locked: the pointer turns the head, the keys walk. The horizon stays
 * level — yaw about world up, pitch clamped to `[minPitch, maxPitch]`, never any roll — and the
 * walk follows the yaw alone, so looking up does not lift the walker off the floor.
 *
 * THE LOCK IS THE HOST'S TO ASK FOR. A browser only grants a pointer lock inside a gesture, so
 * the controller asks on `pointerdown` and publishes `lock()`, `unlock()` and `locked()` for a
 * host that would rather choose its own moment; a lock the viewer escapes simply stops the
 * look. Keys, by `KeyboardEvent.code`: W/S forward and back, A/D strafe, Space and left shift
 * up and down.
 */
export interface FirstPersonCameraControls extends SteeredCameraControls, PersonHead {}

const RISE: KeyAxis = [['Space'], ['ShiftLeft']]

export function createFirstPersonCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): FirstPersonCameraControls {
  const pose = controlPose(camera),
    base = createControlBase()
  const position = new Float64Array(3),
    orientation = new Float64Array(4),
    walk = new Float64Array(2),
    moved = new Float64Array(7)
  const gate = createChangeGate(base, 7)
  const api: FirstPersonCameraControls = {
    ...base.api,
    object: pose.object,
    movementSpeed: 1,
    ...HEAD_DEFAULTS,
    ...headLock(() => head),
    update(delta = 0) {
      const dt = delta > 0 ? delta : 0
      pose.readPosition(position)
      const step = api.movementSpeed * dt
      yawWalk(
        walk,
        head.turn(orientation),
        axisOf(keys, ...STRAFE_KEYS),
        axisOf(keys, ...ADVANCE_KEYS),
      )
      position[0] += walk[0] * step
      position[1] += axisOf(keys, ...RISE) * step
      position[2] += walk[1] * step
      pose.write(position, orientation)
      moved.set(position)
      moved.set(orientation, 3)
      return gate(moved)
    },
  }
  const head = createHead(pose, surface, base, api)
  const keys = trackKeys(surface, base, () => base.emit(), [STRAFE_KEYS, RISE, ADVANCE_KEYS])
  return api
}
