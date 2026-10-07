import { createEngineCamera, readCameraWorld, type HostCamera } from '../../camera/world.ts'
import type { AssetScope, FrameMetrics } from '../../../../sdk-core/src/index.ts'
import type { Engine } from '../../engine/types.ts'
import type { createPageStreamer } from '../../streaming/pageStreamer.ts'
import type { createDiagnosticChannel } from '../../diagnostic/channel.ts'
import type { ExplorerEmitters } from '../session/session.ts'

type Inputs = Pick<ExplorerEmitters, 'diagnose'> & {
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>
  engine: Engine
  camera: HostCamera
  /** Target the host rereads between two poses. Read by its three numbers: the trace does not
   *  have to name a host-library compute type to publish a point. */
  lookAtTarget: { x: number; y: number; z: number }
  metricsScratch: FrameMetrics
  pageIdByUrl: Map<string, number>
  streamer: ReturnType<typeof createPageStreamer>
  scope: AssetScope
  frameNumber: number
}

/** Trace engine camera, allocated once. The diagnostic is outside the measured pass — it is
 *  published after `cpuFrameMs` closes — and it is only copied under `trace`. */
const diagnosticCam = createEngineCamera()

/** The pages the frame asked for or retains, by id where the manifest gives one. */
function requestedPageIds(
  engine: Engine,
  streamer: Inputs['streamer'],
  pageIdByUrl: Map<string, number>,
) {
  const protectedOrRequested = new Set<string | number>()
  const addPage = (url: string) => protectedOrRequested.add(pageIdByUrl.get(url) ?? url)
  for (const url of engine.pendingUrls()) addPage(url)
  const ranks = engine.retainedRanks()
  // A failed draw may reach the trace before normal retention; consume its delta here.
  streamer.retainRanks(ranks)
  for (let i = 0; i < ranks.heldCount; i++) {
    const url = ranks.urls[ranks.held[i]]
    if (url !== undefined) addPage(url)
  }
  return [...protectedOrRequested]
}

export function emitExplorerFrameDiagnostic(inputs: Inputs) {
  const { diagnosticChannel, engine, camera, lookAtTarget, metricsScratch } = inputs
  const { pageIdByUrl, streamer, scope, frameNumber, diagnose } = inputs
  // Snapshot construction and enqueueing happen after cpuFrameMs is closed;
  // the channel defers all observer work to a later microtask.
  if (diagnosticChannel.enabled && diagnosticChannel.detail === 'trace') {
    const protectedOrRequestedPageIds = requestedPageIds(engine, streamer, pageIdByUrl)
    const { eye } = readCameraWorld(diagnosticCam, camera),
      stream = streamer.stats()
    diagnose('frame', 'Rendered frame', {
      kind: 'frame',
      timingScope: 'host-render',
      scope,
      frame: frameNumber,
      camera: {
        // World pose, not local pose: under a host rig, the diagnostic would otherwise place
        // the camera elsewhere than where the frame was drawn. `readCameraWorld` resolves the
        // ancestors and copies the pose into the engine camera, as frame entry does.
        position: [eye[0], eye[1], eye[2]],
        target: [lookAtTarget.x, lookAtTarget.y, lookAtTarget.z],
        fov: diagnosticCam.fov,
        near: diagnosticCam.near,
        far: diagnosticCam.far,
      },
      timestamp: Date.now(),
      metrics: { ...metricsScratch },
      selection: {
        clusters: metricsScratch.clusters,
        selectedTriangles: metricsScratch.selectedTriangles,
        frustumRejected: metricsScratch.frustumRejected,
        lodLevel: metricsScratch.lodLevel,
      },
      display: {
        protectedOrRequestedPageIds,
        selectedTriangles: metricsScratch.selectedTriangles,
        submittedTriangles: metricsScratch.submittedTriangles,
      },
      cache: {
        residentPages: metricsScratch.residentPages,
        cacheResident: stream.resident,
        cacheEvictions: stream.evictions,
        reason: 'cache-eviction-is-separate-from-display-detachment',
      },
      reportedDrawStats: {
        drawCalls: metricsScratch.drawCalls,
        submittedTriangles: metricsScratch.submittedTriangles,
        geometryAllocationBytes: metricsScratch.geometryAllocationBytes,
      },
    })
  }
}
