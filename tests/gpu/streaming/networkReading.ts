// What the geometry network proof reads: the bench scenes served over HTTP, every answer held back by
// a round trip, each cache object's transfer recorded where the network sees it; and one opening of
// a scene over it — the pages the GPU pool admitted while the camera stood still, the horizons the
// view ahead looked at while it moved, what failed.
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { ASSETS } from '../../../bench/runner/assets/scene.ts'
import { poseAt } from '../../../bench/runner/trajectory/poses.ts'
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/engine/types.ts'
import { isCacheObject } from '../../../scripts/compress-cache-objects.ts'
import { listen, staticServer } from '../../../scripts/static-server.ts'
import { openEngineWorld, proofCanvas } from '../kit/renderHarness.ts'

/** One cache object's transfer as the server saw it, on its clock: asked, and answered. */
type Transfer = { sent: number; done: number }

/** The bench assets served at `/benchmark-assets/` on the loopback, each request answered
 *  `roundTripMs` after it arrived; the cache objects' transfers are recorded in `transfers`. */
export async function servedAssets(roundTripMs: number) {
  const files = staticServer({ mounts: [{ prefix: '/benchmark-assets/', dir: ASSETS }] })
  const transfers: Transfer[] = []
  const server = createServer((request, response) => {
    if (isCacheObject(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)) {
      const transfer = { sent: performance.now(), done: Infinity }
      transfers.push(transfer)
      response.once('close', () => (transfer.done = performance.now()))
    }
    setTimeout(() => files.emit('request', request, response), roundTripMs)
  })
  const port = await listen(server)
  return {
    origin: `http://127.0.0.1:${port}`,
    transfers,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

/** How many transfers were sent while another was still in flight: reads issued one after the
 *  other's end count none, reads issued together all but the first. */
export const sentAlongside = (transfers: readonly Transfer[]) =>
  transfers.filter((t) => transfers.some((o) => o !== t && o.sent <= t.sent && o.done > t.sent))
    .length

/** Opens `manifestUrl` on the WebGPU page raster at pose 0 and renders until the image is held,
 *  giving up after `holdMs` of wall time, then walks the trajectory up to pose `poses`, one pose a
 *  frame. */
export async function readOverNetwork(manifestUrl: string, poses: number, holdMs: number) {
  const admitted: string[] = [],
    horizons: number[] = [],
    failures: string[] = []
  let moving = false
  const onDiagnostic = ({ phase, context }: EngineDiagnostic) => {
    // The pool's own record of a page written into a slot: the admission, in its order.
    if (phase === 'cache-gpu-page-upload') {
      if (!moving) admitted.push(String(context?.key))
    } else if (phase === 'gpu-selection-current-frame') {
      if (moving) horizons.push(Number(context?.aheadHorizonMs))
    }
    // A page read that failed, not one the view cancelled, would leave a page out of the pool.
    else if (phase === 'cache-gpu-page-error') {
      if (!context?.aborted) failures.push(`${phase}: ${String(context?.error)}`)
    }
    // A record the bounded channel dropped (`diagnostic-loss`) would hide an admission.
    else if (/failed|lost|loss/.test(phase)) failures.push(phase)
  }
  const canvas = proofCanvas('network')
  const world = await openEngineWorld(canvas, {
    manifestUrl,
    scope: 'full',
    width: 1280,
    height: 800,
    pixelRatio: 1,
    pixelError: 1,
    textureSource: 'cache',
    temporalAntialiasing: false,
    diagnosticDetail: 'trace',
    onDiagnostic,
  })
  try {
    const frame = async (pose: number) => {
      world.setPose(poseAt(world.bounds, pose))
      const metrics = world.render()
      await world.flush()
      return metrics.frameHeld
    }
    let held = await frame(0)
    for (const until = performance.now() + holdMs; !held && performance.now() < until;) {
      await sleep(20)
      held = await frame(0)
    }
    moving = true
    for (let pose = 1; pose <= poses; pose++) await frame(pose)
    return { admitted, horizons, failures, held }
  } finally {
    world.dispose()
    canvas.remove()
  }
}
