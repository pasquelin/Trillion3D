// A world opened with the engine's own defaults, wherever the proof's page runs: one opening, so
// every proof that reads a default image reads the same.
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/engine/types.ts'
import type { openMeasuredWorld } from '../../../packages/sdk-browser/src/measurement/measurement.ts'
import type { SceneLight } from '../../../packages/sdk-core/src/index.ts'

/**
 * `manifestUrl` opened on `canvas` by `open` (the page's own import of `openMeasuredWorld`: on Dawn
 * it loads after the GPU) with no `engine` option — the session's own engine —, lit
 * by `lights` before its first frame (a cache whose light table is empty is lit by its host or by
 * nothing), and posed at its first point of interest once its pages are in. The world, and the
 * texture source the session opened with, in its own words (`texture-source`); a failure disposes
 * of it.
 */
export async function openDefaultWorld(
  open: typeof openMeasuredWorld,
  canvas: HTMLCanvasElement,
  manifestUrl: string,
  lights: readonly SceneLight[],
) {
  const sources: EngineDiagnostic[] = []
  const world = await open(canvas, {
    manifestUrl,
    scope: 'full',
    width: 480,
    height: 320,
    pixelRatio: 1,
    temporalAntialiasing: false,
    pixelError: 0,
    onDiagnostic: (event) => void (event.phase === 'texture-source' && sources.push(event)),
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
    /** The texture source the session opened with, as its diagnostic said it. */
    textureSource: () => (sources[0]?.context.textureSource as string | undefined) ?? null,
  }
}
