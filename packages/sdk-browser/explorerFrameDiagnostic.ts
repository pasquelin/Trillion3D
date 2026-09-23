import { createEngineCamera, readCameraWorld, type HostCamera } from './cameraWorld.ts';
import type { AssetScope, FrameMetrics } from '../sdk-core/src/index.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { createDiagnosticChannel } from './diagnosticChannel.ts';
import type { ExplorerEmitters } from './explorerSession.ts';

type Inputs = Pick<ExplorerEmitters, 'diagnose'> & {
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>;
  active: RenderBackend;
  camera: HostCamera;
  /** Target the host rereads between two poses. Read by its three numbers: the trace does not
   *  have to name a host-library compute type to publish a point. */
  lookAtTarget: { x: number; y: number; z: number };
  metricsScratch: FrameMetrics;
  pageIdByUrl: Map<string, number>;
  streamer: ReturnType<typeof createPageStreamer>;
  measuring: boolean;
  scope: AssetScope;
  frameNumber: number;
};

/** Trace engine camera, allocated once. The diagnostic is outside the measured pass — it is
 *  published after `cpuFrameMs` closes — and it is only copied under `trace`. */
const diagnosticCam = createEngineCamera();

export function emitExplorerFrameDiagnostic(inputs: Inputs) {
  const {
    diagnosticChannel,
    active,
    camera,
    lookAtTarget,
    metricsScratch,
    pageIdByUrl,
    streamer,
    measuring,
    scope,
    frameNumber,
    diagnose,
  } = inputs;
  // Snapshot construction and enqueueing happen after cpuFrameMs is closed;
  // the channel defers all observer work to a later microtask.
  if (diagnosticChannel.enabled && diagnosticChannel.detail === 'trace') {
    const { eye } = readCameraWorld(diagnosticCam, camera),
      pendingUrls = [...(active.pendingUrls?.() ?? [])],
      protectedOrRequestedPageIds = [
        ...new Set(
          [...pendingUrls, ...(active.pageUrls?.() ?? [])].map(
            (url) => pageIdByUrl.get(url) ?? url,
          ),
        ),
      ],
      stream = streamer.stats(),
      backendReport = active.metrics();
    diagnose('frame', 'Rendered frame', {
      kind: 'frame',
      nature: measuring ? 'measurement' : 'beauty',
      timingScope: 'host-render',
      scope,
      frame: frameNumber,
      backend: active.id,
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
        batchRebuilds: backendReport.batchRebuilds ?? null,
        batchIndexBytesUpdated: backendReport.batchIndexBytesUpdated ?? null,
        autonomousClusterDrawsTotal: metricsScratch.autonomousClusterDrawsTotal ?? null,
        autonomousCopyDraws: metricsScratch.autonomousCopyDraws ?? null,
      },
    });
  }
}
