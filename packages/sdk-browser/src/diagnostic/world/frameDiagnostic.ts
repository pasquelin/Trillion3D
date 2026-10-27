import type { AssetScope } from '../../../../sdk-core/src/contracts/base.ts'
import type { FrameMetrics } from '../../../../sdk-core/src/contracts/metrics.ts'
import type { Engine } from '../../session/engine/types.ts'
import type { PageStreaming } from '../../geometry/streaming/pageStreamer.ts'
import { retainHeldUrls } from '../../geometry/streaming/hostRanks.ts'
import type { createDiagnosticChannel } from '../channel.ts'
import type { ExplorerEmitters } from '../../session/session.ts'

type Inputs = Pick<ExplorerEmitters, 'diagnose'> & {
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>
  engine: Engine
  /** Target the host rereads between two poses. Read by its three numbers: the trace does not
   *  have to name a host-library compute type to publish a point. */
  lookAtTarget: { x: number; y: number; z: number }
  metricsScratch: FrameMetrics
  pageIdByUrl: Map<string, number>
  streamer: PageStreaming
  /** The queue's numbers the frame's metrics read (`fillMetrics`). */
  stream: { resident: number }
  scope: AssetScope
  frameNumber: number
}

/** The pages the frame asked for or retains, by id where the manifest gives one. */
function requestedPageIds(
  engine: Engine,
  streamer: Inputs['streamer'],
  pageIdByUrl: Map<string, number>,
) {
  const protectedOrRequested = new Set<string | number>()
  const addPage = (url: string) => protectedOrRequested.add(pageIdByUrl.get(url) ?? url)
  for (const url of engine.pendingUrls()) addPage(url)
  // A failed draw may reach the trace before normal retention; consume its delta here.
  retainHeldUrls(streamer, engine.retainedRanks(), addPage)
  return [...protectedOrRequested]
}

export function emitExplorerFrameDiagnostic(inputs: Inputs) {
  const { diagnosticChannel, engine, lookAtTarget, metricsScratch } = inputs
  const { pageIdByUrl, streamer, stream, scope, frameNumber, diagnose } = inputs
  // Snapshot construction and enqueueing happen after cpuFrameMs is closed;
  // the channel defers all observer work to a later microtask.
  if (diagnosticChannel.enabled && diagnosticChannel.detail === 'trace') {
    const protectedOrRequestedPageIds = requestedPageIds(engine, streamer, pageIdByUrl)
    // The camera the frame was drawn from, planes and origin as every pass saw them.
    const drawn = engine.drawnCamera()
    diagnose('frame', 'Rendered frame', {
      kind: 'frame',
      timingScope: 'host-render',
      scope,
      frame: frameNumber,
      // World pose, not local pose: under a host rig, the diagnostic would otherwise place the
      // camera elsewhere than where the frame was drawn; none before the first image.
      camera: drawn && {
        position: [drawn.eye[0], drawn.eye[1], drawn.eye[2]],
        target: [lookAtTarget.x, lookAtTarget.y, lookAtTarget.z],
        fov: drawn.fov,
        near: drawn.near,
        far: drawn.far,
      },
      timestamp: Date.now(),
      // The frame's metrics once, every count among them; beside them only what they lack.
      metrics: { ...metricsScratch },
      display: { protectedOrRequestedPageIds },
      cache: {
        cacheResident: stream.resident,
        reason: 'cache-eviction-is-separate-from-display-detachment',
      },
    })
  }
}
