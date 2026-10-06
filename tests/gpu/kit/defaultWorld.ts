// A world opened on the engine's own choice of backend, wherever the proof's page runs — on Dawn,
// or in Chrome on a machine without WebGPU: one opening, so both machines are proved on the same.
import type { BackendDiagnostic } from '../../../packages/sdk-browser/src/backend/types.ts'
import type { openMeasuredWorld } from '../../../packages/sdk-browser/src/measurement/measurement.ts'
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts'

/**
 * `manifestUrl` opened on `canvas` by `open` (the page's own import of `openMeasuredWorld`: on Dawn
 * it loads after the GPU) with no `backends` option — the engine reads the machine and chooses —,
 * lit by `lights` before its first frame (a cache whose light table is empty is lit by its host or
 * by nothing), and posed at its first point of interest once its pages are in. The world, and what
 * the engine chose and mounted, in its own words (`backend-choice`); a failure disposes of it.
 */
export async function openDefaultWorld(
  open: typeof openMeasuredWorld,
  canvas: HTMLCanvasElement,
  manifestUrl: string,
  lights: readonly SceneLight[],
) {
  const choices: BackendDiagnostic[] = []
  const world = await open(canvas, {
    manifestUrl,
    scope: 'full',
    width: 480,
    height: 320,
    pixelRatio: 1,
    temporalAntialiasing: false,
    pixelError: 0,
    onDiagnostic: (event) => void (event.phase === 'backend-choice' && choices.push(event)),
  })
  try {
    for (const light of lights) world.addLight(light)
    world.setPose(world.pointsOfInterest()[0].pose)
    await world.awaitPages()
  } catch (error) {
    world.dispose()
    throw error
  }
  return {
    world,
    /** The backend's name and every one mounted, and the engine's account of its choice. */
    chosen: () => ({
      backend: world.backend,
      mounted: world.backends.map((one) => one.id),
      choice: choices[0]?.context ?? null,
    }),
  }
}
