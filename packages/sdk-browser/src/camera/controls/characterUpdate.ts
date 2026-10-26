import type { createChangeGate } from './base.ts'
import { readInput, type BodySlot, type CharacterKeys } from './characterInput.ts'
import type { CharacterCameraControls } from './characterControls.ts'
import type { createHead } from './look.ts'
import type { ControlPose } from './pose.ts'
import type { createCharacterEye } from '../../../../sdk-core/src/collision/characterEye.ts'
import { sameValues } from '../../../../math/src/matrix/matrixElements.ts'

/** Where a crouched eye stands over the feet, in halves of the crouched body: its centre and four fifths of its half height above. */
const CROUCHED_EYE = 1.8

/** The buffers a character update writes in place. */
export function createCharacterBuffers() {
  return {
    at: new Float64Array(3),
    written: new Float64Array(3).fill(NaN),
    orientation: new Float64Array(4),
    moved: new Float64Array(7),
    input: { wishX: 0, wishY: 0, wishZ: 0, jump: false, crouch: false },
    wish: new Float64Array(2),
  }
}

/** What an update of the character reads and writes. */
export type CharacterRig = ReturnType<typeof createCharacterBuffers> & {
  api: CharacterCameraControls
  pose: ControlPose
  slot: BodySlot
  head: ReturnType<typeof createHead>
  eye: ReturnType<typeof createCharacterEye>
  keys: CharacterKeys
  events: { onLand(impact: number): void; onJump(): void }
  gate: ReturnType<typeof createChangeGate>
}

/** Lives `delta` seconds; returns whether the camera moved, and emits `change` when it did. */
export function updateCharacter(rig: CharacterRig, delta: number) {
  const { api, pose, slot, head, eye, keys, at, written, orientation, moved, input } = rig
  pose.readPosition(at)
  if (!sameValues(at, written)) slot.body.place(at[0], at[1] - api.eyeHeight, at[2])
  const yaw = head.turn(orientation)
  readInput(input, rig.wish, keys, orientation, slot.body.mode, yaw)
  const feet = slot.body.advance(delta, input, rig.events)
  written.set(feet)
  const stand = slot.body.crouched ? (api.crouchedHeight / 2) * CROUCHED_EYE : api.eyeHeight
  written[1] += stand + eye.offset(delta, slot.body.velocity, slot.body.onGround)
  pose.write(written, orientation)
  moved.set(written)
  moved.set(orientation, 3)
  return rig.gate(moved)
}
