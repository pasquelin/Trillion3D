import type { Engine } from '../../engine/types.ts'
import type { HostCamera } from '../../camera/world.ts'

/** What the session reads of its engine directly: its images. */
export function engineReads(engine: Engine, check: () => void, camera: HostCamera) {
  return {
    /** The session's current image, bottom row first, at the canvas's size: the engine reads its
     *  GPU image back itself — the one its last flush read when it is still current, else one
     *  texture copy into a mapped buffer, awaited without stalling a frame. */
    capture: async () => (check(), engine.capture()),
    /** The composed image of the session's camera at `width × height`, bottom row first, drawn
     *  OFFSCREEN in a view of the engine's own at that size: the page's canvas keeps its size
     *  and its image. */
    captureView: async (width: number, height: number) => (
      check(),
      engine.captureColorView(camera, { width, height })
    ),
  }
}
