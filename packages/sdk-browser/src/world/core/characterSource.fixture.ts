import type {
  CharacterBody,
  CharacterSettings,
} from '../../../../sdk-core/src/collision/characterSettings.ts'
import type { CharacterSource } from './worldControlTargets.ts'

/** A physics body reduced to what the controller reads: an endless floor at y = 0, a walk at
 *  the wished speed, a jump at `jumpSpeed`, a fall under `gravity`. */
function floorBody(settings: CharacterSettings): CharacterBody {
  const feet = new Float64Array(3),
    velocity = new Float64Array(3)
  let grounded = false,
    jumped = false
  return {
    feet,
    velocity,
    get onGround() {
      return grounded
    },
    place(x, y, z) {
      feet.set([x, y, z])
      velocity.fill(0)
      grounded = false
    },
    pressJump() {
      if (!grounded) return
      velocity[1] = settings.jumpSpeed
      grounded = false
      jumped = true
    },
    advance(delta, input, events) {
      const speed = input.sprint ? settings.sprintSpeed : settings.walkSpeed
      velocity[0] = input.wishX * speed
      velocity[2] = input.wishZ * speed
      if (jumped) events?.onJump?.()
      jumped = false
      if (!grounded) velocity[1] -= settings.gravity * delta
      for (let k = 0; k < 3; k++) feet[k] += velocity[k] * delta
      grounded = feet[1] <= 0 && velocity[1] <= 0
      if (grounded) [feet[1], velocity[1]] = [0, 0]
      return feet
    },
  }
}

/** The world's physics as the controls see it: running, with a floor body, or not running. */
export function floorPhysics(running = true) {
  let listener = () => {}
  const source: CharacterSource & { running: boolean; start(): void } = {
    running,
    body: () => (source.running ? floorBody : null),
    watch: (next) => void (listener = next),
    start() {
      source.running = true
      listener()
    },
  }
  return source
}
