import type { MeasuredWorld } from '../explorer.ts'
import type { Scene } from './scene.ts'

/**
 * The scene's background as the session's clear colour, a per-frame value like exposure, and its
 * one way in: written before the first frame of every session, and before the frame that first
 * shows a new colour; a frame where neither changed compares one number and one session.
 */
export function createWorldBackground(scene: Scene) {
  let written: number | undefined,
    to: MeasuredWorld | null = null
  return {
    /** Writes the colour to a new session, or when it differs from the last one written. */
    write(session: MeasuredWorld) {
      const hex = scene.background?.getHex()
      if (session === to && hex === written) return
      to = session
      written = hex
      session.setClearColor(hex)
    },
  }
}
