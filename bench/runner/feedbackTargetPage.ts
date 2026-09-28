import type * as Sdk from '../witnesses/measurement.ts';
import type {
  CameraPose,
  FrameMetrics,
  GpuPassTimings,
} from '../../packages/sdk-core/src/index.ts';
import { poseAt, type Bounds } from './poses.ts';
import { posterCapture } from './measurePage.ts';
import { captureConvergence, type ConvergenceProof } from './feedbackConvergencePage.ts';
import type { SpatialFeedback } from '../../packages/sdk-browser/src/webgpu/pages/diagnostic/feedbackSpatial.ts';

type Probe = {
  setFeedbackTargetAb(target: boolean): Promise<void>;
  feedbackAbResidency(): Promise<{
    geometry: { count: number; sha256: string };
    tiles: { count: number; sha256: string };
  }>;
  captureFeedbackAb(): Promise<Uint8Array>;
  feedbackAbSpatial(): Promise<SpatialFeedback>;
};
type Reading = {
  target: boolean;
  gpuFrameMs: number[];
  gpuPassSamples: GpuPassTimings[];
  counters: Partial<FrameMetrics>;
  residency: Awaited<ReturnType<Probe['feedbackAbResidency']>>;
  capture: string;
};

export type FeedbackTargetResult = {
  supported: boolean;
  reason: string | null;
  pose: CameraPose | null;
  readings: Reading[];
  convergence: ConvergenceProof | null;
};

/** One page, one device, one pose. The backend switch never reloads pages or the scene. */
export async function runFeedbackTarget(options: {
  sdkUrl: string;
  manifestUrl: string;
  scene: string;
  view: number;
  frames: number;
  pixelError: number;
}): Promise<FeedbackTargetResult> {
  const sdk = (await import(options.sdkUrl)) as typeof Sdk;
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  let convergence: ConvergenceProof | null = null;
  const unsupported = (reason: string): FeedbackTargetResult => ({
    supported: false,
    reason,
    pose: null,
    readings: [],
    convergence,
  });
  let explorer: Sdk.MeasuredWorld | undefined;
  try {
    explorer = await sdk.openMeasuredWorld(canvas, {
      manifestUrl: options.manifestUrl,
      scope: 'full',
      width: 2496,
      height: 1404,
      pixelRatio: 1,
      replicaCount: 1,
      detail: 'source',
      pixelError: options.pixelError,
      lodAdaptive: false,
      preload: 'visible',
      backends: [sdk.webgpuPagesBackend],
      comparisonLayout: 'single',
      clearColor: 0x2a303c,
      diagnosticDetail: 'summary',
      textureSource: 'cache',
      temporalAntialiasing: true,
      stageProfile: true,
      feedbackTargetAB: true,
    });
    const backend = explorer.backends.find((item) => item.id === 'webgpu-page-raster') as
      (Sdk.RenderBackend & Partial<Probe>) | undefined;
    if (
      !backend?.setFeedbackTargetAb ||
      !backend.feedbackAbResidency ||
      !backend.captureFeedbackAb ||
      !backend.feedbackAbSpatial
    )
      return unsupported('FEEDBACK_AB_UNAVAILABLE');
    const box = explorer.bounds;
    const bounds: Bounds = {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
    };
    const pose = poseAt(bounds, options.view);
    explorer.setPose(pose);
    convergence = await captureConvergence(
      explorer,
      backend as Probe,
      pose,
      `${options.scene}-${options.view}`,
      canvas,
    );
    if (!convergence.supported) return unsupported(convergence.reason!);
    const readings: Reading[] = [];
    for (const [index, target] of [true, false, true].entries()) {
      await backend.setFeedbackTargetAb(target);
      const gpuFrameMs: number[] = [];
      const gpuPassSamples: GpuPassTimings[] = [];
      let last: FrameMetrics | null = null;
      let seen = -1,
        warmFrame = -1;
      // The first frames after a toggle are outside the timed window.
      for (let i = 0; i < options.frames + 12; i++) {
        await new Promise<number>((done) => requestAnimationFrame(done));
        last = explorer.render(pose);
        const sample = last.gpuPassMs;
        if (i < 12) {
          if (sample) warmFrame = Math.max(warmFrame, sample.frame);
          continue;
        }
        if (!sample || sample.frame <= warmFrame || sample.frame === seen) continue;
        seen = sample.frame;
        gpuPassSamples.push(sample);
        if (typeof last.gpuFrameMs === 'number') gpuFrameMs.push(last.gpuFrameMs);
      }
      if (!last) return unsupported('FEEDBACK_AB_NO_FRAME');
      const capture = `${options.scene}-${options.view}-${index}.rgba`;
      const residency = await backend.feedbackAbResidency();
      const response = await posterCapture(
        capture,
        await backend.captureFeedbackAb(),
        canvas.width,
        canvas.height,
      );
      if (!response.ok) return unsupported(`FEEDBACK_AB_CAPTURE_${response.status}`);
      readings.push({
        target,
        gpuFrameMs,
        gpuPassSamples,
        residency,
        counters: {
          gpuFrameTargetBytes: last.gpuFrameTargetBytes,
          residentPages: last.residentPages,
          pagesLoading: last.pagesLoading,
          coverageReady: last.coverageReady,
          selectedTriangles: last.selectedTriangles,
          drawnTriangles: last.drawnTriangles,
          uncoveredTriangles: last.uncoveredTriangles,
          textureTilesResident: last.textureTilesResident,
          textureTilesPending: last.textureTilesPending,
          textureTilesRequested: last.textureTilesRequested,
          textureTilesAtLevel: last.textureTilesAtLevel,
          textureMissingLevels: last.textureMissingLevels,
          textureTilesRefused: last.textureTilesRefused,
          frameHeld: last.frameHeld,
        },
        capture,
      });
    }
    return {
      supported: true,
      reason: null,
      pose,
      readings,
      convergence,
    };
  } catch (error) {
    return unsupported(String(error));
  } finally {
    explorer?.dispose();
    canvas.remove();
  }
}
