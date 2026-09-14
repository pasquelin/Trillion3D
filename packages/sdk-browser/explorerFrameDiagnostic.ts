import * as THREE from 'three';
import type { AssetScope, FrameMetrics } from '../sdk-core/index.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { createDiagnosticChannel } from './diagnosticChannel.ts';

type Inputs = {
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>;
  active: RenderBackend;
  camera: THREE.PerspectiveCamera;
  lookAtTarget: THREE.Vector3;
  metricsScratch: FrameMetrics;
  pageIdByUrl: Map<string, number>;
  streamer: ReturnType<typeof createPageStreamer>;
  measuring: boolean;
  scope: AssetScope;
  frameNumber: number;
  diagnose: (phase: string, message: string, context?: Record<string, unknown>) => void;
};

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
    const pendingUrls = [...(active.pendingUrls?.() ?? [])],
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
        position: camera.position.toArray(),
        target: lookAtTarget.toArray(),
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
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
        displayDetachments: backendReport.displayDetachments ?? null,
      },
    });
  }
}
