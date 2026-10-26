import { createChangeGate, createControlBase } from './base.ts'
import { controlPose } from './pose.ts'
import { createHead, HEAD_DEFAULTS, headLock, type PersonHead } from './look.ts'
import { createCharacterEye } from '../../../../sdk-core/src/collision/characterEye.ts'
import {
  HUMAN_BODY,
  type CharacterSettings,
} from '../../../../sdk-core/src/collision/characterSettings.ts'
import type { CharacterMode } from '../../../../sdk-core/src/collision/characterModes.ts'
import { createBodySlot, definePhysics, trackCharacterKeys } from './characterInput.ts'
import { createCharacterBuffers, updateCharacter, type CharacterRig } from './characterUpdate.ts'
import type { CameraControlBase, ControlCamera } from './types.ts'

/**
 * A CHARACTER, seen through its eyes: a body with mass that walks, runs, jumps and falls, and
 * collides with the bodies of the world's physics as an upright capsule.
 *
 * The pointer turns the head as in first person (`look.ts`). The keys, by `KeyboardEvent.code`
 * so every keyboard layout plays the same keys: W/S or the up and down arrows walk forward
 * and back, A/D or the side arrows strafe, Space jumps, C crouches
 * (`canCrouch`); in water the body swims where the head looks, Space rising and the crouch key sinking,
 * and with `flying` set it flies so. The body does not start
 * or stop at once: on a floor it gathers speed by `maxAcceleration` and brakes by
 * `groundFriction` and `brakingDecelerationWalking`; it keeps its momentum in the air, rises and falls under the world's gravity times `gravityScale`,
 * climbs ledges up to `stepHeight`, slides along walls and stands on
 * slopes up to `maxSlope`
 * (`sdk-browser/src/physics/character/characterDriver.ts`, `sdk-core/src/collision/characterDrive.ts`).
 *
 * The camera is the eye, `eyeHeight` above the feet, bobbing with the stride by `headBob` and
 * dipping on a landing by `landingDip` (`sdk-core/src/collision/characterEye.ts`); both ride on
 * the eye after the body's step and never move the body. A host that moves the camera itself
 * teleports the body there, at rest. A still character — grounded, no speed, no key, no dip left
 * — emits nothing, so the scene stays still.
 */
export interface CharacterCameraControls extends CameraControlBase, PersonHead, CharacterSettings {
  /** The body's velocity in metres per second, live: `[x, y, z]`, y up. */
  readonly velocity: Readonly<Float64Array>
  /** Whether the feet are on a floor. */
  readonly onGround: boolean
  /** How the body moves now: `walking`, `falling`, `swimming` or `flying`. */
  readonly mode: CharacterMode
  /** Whether the body is crouched. */
  readonly crouched: boolean
  /** The stride's phase in radians, in [0, 2π): one foot strikes at 0, the other at π. */
  readonly stride: number
  /** Called on landing with the downward speed, in metres per second: a sound, a shake. */
  onLand: ((impact: number) => void) | null
  /** Called when the body leaves the ground on a jump. */
  onJump: (() => void) | null
  /** Lives `delta` seconds; returns whether the camera moved, and emits `change` when it did. */
  update(delta?: number): boolean
}

export function createCharacterCameraControls(
  camera: ControlCamera,
  surface: HTMLElement,
): CharacterCameraControls {
  const pose = controlPose(camera),
    base = createControlBase()
  const buffers = createCharacterBuffers()
  const gate = createChangeGate(base, 7)
  const slot = createBodySlot()
  const api: CharacterCameraControls = {
    ...base.api,
    ...HUMAN_BODY,
    object: pose.object,
    ...HEAD_DEFAULTS,
    onLand: null,
    onJump: null,
    get velocity() {
      return slot.body.velocity
    },
    get onGround() {
      return slot.body.onGround
    },
    get mode() {
      return slot.body.mode ?? 'falling'
    },
    get crouched() {
      return slot.body.crouched ?? false
    },
    get stride() {
      return eye.stride
    },
    ...headLock(() => head),
    update: (delta = 0) => updateCharacter(rig, delta),
  }
  definePhysics(api, slot)
  base.undo(() => slot.body.dispose?.())
  // A paused controller lets go of its keys: a body elsewhere must hear it.
  base.onPause(() => slot.body.advance(0, { wishX: 0, wishZ: 0 }))
  const eye = createCharacterEye(api)
  const events = {
    onLand: (impact: number) => (eye.land(impact), api.onLand?.(impact)),
    onJump: () => api.onJump?.(),
  }
  const head = createHead(pose, surface, base, api)
  const keys = trackCharacterKeys(surface, base, slot)
  const rig: CharacterRig = { api, pose, slot, head, eye, keys, events, gate, ...buffers }
  return api
}
