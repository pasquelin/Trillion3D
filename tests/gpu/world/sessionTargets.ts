// What a session opens on, read on Dawn: the same canvas named by its id or given as an element
// draws the same image, and the job and abort paths of a session that really opens on the device —
// overridden sizes, an abort that disposes it, a cancelled job. A target that is no canvas, or a
// named raster with no device, fails before any GPU work (`world/session/target.test.ts`).
import { pixelDifference } from '../../../bench/dawn/capture.ts'
import type {
  MeasuredWorldOptions,
  MeasuredWorldTarget,
} from '../../../bench/witnesses/measurement.ts'
import { settle } from './proofWorld.ts'
import { measurementSdk, openEngineWorld } from '../kit/renderHarness.ts'

/** Opens `manifestUrl` on the canvas `viewer` three ways and through a job, aborts one session and
 *  cancels a job: what each answered. */
export async function sessionTargets(manifestUrl: string, viewer: HTMLCanvasElement) {
  const { createMeasuredWorldJob, webgpuPagesEngine } = await measurementSdk()
  const options: Omit<MeasuredWorldOptions, 'engine'> = {
    manifestUrl,
    scope: 'full',
    width: 240,
    height: 160,
    pixelRatio: 1,
    temporalAntialiasing: false,
    geometryPoolBytes: 16 * 1024 * 1024,
    texturePoolBytes: 128 * 1024 * 1024,
  }
  const images: Uint8Array[] = [],
    triangles: [number | null | undefined, number | null | undefined][] = []
  for (const target of [viewer.id, viewer, viewer.id] as MeasuredWorldTarget[]) {
    const world = await openEngineWorld(target, options)
    await world.awaitPages()
    await settle(world)
    // An encoded frame, forced, so its submitted triangles describe this draw.
    world.setDiagnostic('beauty')
    const metrics = world.render()
    await world.flush()
    images.push(new Uint8Array(await world.capture()))
    triangles.push([metrics.totalSubmittedTriangles, metrics.selectedTriangles])
    world.dispose()
  }
  const differences = images.slice(1).map((image) => pixelDifference(image, images[0]).pixels)
  const job = await createMeasuredWorldJob('scene-job', viewer.id, {
    ...options,
    engine: webgpuPagesEngine,
    interactive: true,
  })
  const fromJob = await job.promise
  const overrides = [fromJob.canvas.width, fromJob.canvas.height]
  fromJob.dispose()
  const controller = new AbortController()
  const aborted = await openEngineWorld(viewer, {
    ...options,
    interactive: true,
    signal: controller.signal,
  })
  controller.abort()
  let disposedOnAbort = false
  try {
    aborted.render()
  } catch {
    disposedOnAbort = true
  }
  const cancelled = await createMeasuredWorldJob('cancelled-job', viewer.id, {
    ...options,
    engine: webgpuPagesEngine,
  })
  cancelled.cancel()
  await cancelled.promise.catch(() => {})
  return {
    differences,
    triangles,
    hasImage: new Set(images[0]).size > 4,
    overrides,
    disposedOnAbort,
    cancelled: cancelled.getSnapshot().status,
  }
}
