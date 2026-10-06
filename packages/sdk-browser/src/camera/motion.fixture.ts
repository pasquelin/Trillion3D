import type { CameraMotion } from './motion.ts'

/**
 * Forgets the last read: the next one starts from rest. Its arrays are let go, never written, so a
 * copy of `motion` taken before — a capture's saved view — keeps the pose it held.
 */
export function restartCameraMotion(motion: CameraMotion) {
  motion.last = motion.lastBack = motion.velocity = motion.ahead = motion.axis = undefined
  motion.lastMs = motion.steadyMs = motion.turnSteadyMs = undefined
  motion.turn = 0
}
