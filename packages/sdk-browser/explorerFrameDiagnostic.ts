import { createEngineCamera, readCameraWorld, type HostCamera } from './cameraWorld.ts';
import type { AssetScope, FrameMetrics } from '../sdk-core/index.ts';
import type { RenderBackend } from './backendTypes.ts';
import type { createPageStreamer } from './streamingPages.ts';
import type { createDiagnosticChannel } from './diagnosticChannel.ts';
import type { ExplorerEmitters } from './explorerSession.ts';

type Inputs = Pick<ExplorerEmitters, 'diagnose'> & {
  diagnosticChannel: ReturnType<typeof createDiagnosticChannel>;
  active: RenderBackend;
  camera: HostCamera;
  /** La cible que l'hôte relit entre deux poses. Lue par ses trois nombres : la trace n'a pas à
   *  nommer un type de calcul de la bibliothèque hôte pour publier un point. */
  lookAtTarget: { x: number; y: number; z: number };
  metricsScratch: FrameMetrics;
  pageIdByUrl: Map<string, number>;
  streamer: ReturnType<typeof createPageStreamer>;
  measuring: boolean;
  scope: AssetScope;
  frameNumber: number;
};

/** La caméra du moteur de la trace, allouée une fois. Le diagnostic est hors de la passe mesurée —
 *  il est publié après la fermeture de `cpuFrameMs` — et il n'est recopié que sous `trace`. */
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
        // La pose monde, pas la pose locale : sous un rig d'hôte, le diagnostic dirait sinon la
        // caméra ailleurs que là où l'image a été dessinée. `readCameraWorld` résout les ancêtres
        // et recopie la pose dans la caméra du moteur, comme le fait une entrée d'image.
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
        displayDetachments: backendReport.displayDetachments ?? null,
      },
    });
  }
}
