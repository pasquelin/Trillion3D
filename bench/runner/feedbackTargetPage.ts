import type * as Sdk from '../witnesses/measurement.ts';
import type {
  CameraPose,
  FrameMetrics,
  GpuPassTimings,
} from '../../packages/sdk-core/src/index.ts';
import { poseAt, type Bounds } from './poses.ts';
import { posterCapture } from './measurePage.ts';

type Probe = { setFeedbackTargetAb(target: boolean): Promise<void> };
type Reading = {
  target: boolean;
  frames: number;
  gpuFrameMs: number[];
  gpuPassSamples: GpuPassTimings[];
  counters: Partial<FrameMetrics>;
  capture: string;
};

export type FeedbackTargetResult = {
  supported: boolean;
  reason: string | null;
  pose: CameraPose | null;
  readings: Reading[];
  size: { width: number; height: number } | null;
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
  const unsupported = (reason: string): FeedbackTargetResult => ({
    supported: false,
    reason,
    pose: null,
    readings: [],
    size: null,
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
    if (!backend?.setFeedbackTargetAb) return unsupported('FEEDBACK_AB_UNAVAILABLE');
    const box = explorer.bounds;
    const bounds: Bounds = {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      max: { x: box.max.x, y: box.max.y, z: box.max.z },
    };
    const pose = poseAt(bounds, options.view);
    explorer.setPose(pose);
    let held = false;
    for (let i = 0; i < 600; i++) {
      await explorer.awaitPages();
      const frame = explorer.render(pose);
      await explorer.flush();
      if (
        frame.frameHeld &&
        frame.textureTilesPending === 0 &&
        frame.textureMissingLevels === 0 &&
        frame.textureTilesRequested === frame.textureTilesAtLevel
      ) {
        held = true;
        break;
      }
    }
    if (!held) return unsupported('FEEDBACK_AB_POSE_NOT_RESIDENT_AND_HELD');
    const readings: Reading[] = [];
    for (const [index, target] of [true, false, true].entries()) {
      await backend.setFeedbackTargetAb(target);
      const gpuFrameMs: number[] = [];
      const gpuPassSamples: GpuPassTimings[] = [];
      let last: FrameMetrics | null = null;
      let seen = -1;
      // The first frames after a toggle are outside the timed window.
      for (let i = 0; i < options.frames + 12; i++) {
        await new Promise<number>((done) => requestAnimationFrame(done));
        last = explorer.render(pose);
        const sample = last.gpuPassMs;
        if (i < 12 || !sample || sample.frame === seen) continue;
        seen = sample.frame;
        gpuPassSamples.push(sample);
        if (typeof last.gpuFrameMs === 'number') gpuFrameMs.push(last.gpuFrameMs);
      }
      await explorer.flush();
      if (!last) return unsupported('FEEDBACK_AB_NO_FRAME');
      const capture = `${options.scene}-${options.view}-${index}.rgba`;
      const response = await posterCapture(
        capture,
        explorer.capture(),
        canvas.width,
        canvas.height,
      );
      if (!response.ok) return unsupported(`FEEDBACK_AB_CAPTURE_${response.status}`);
      readings.push({
        target,
        frames: options.frames,
        gpuFrameMs,
        gpuPassSamples,
        counters: {
          gpuFrameTargetBytes: last.gpuFrameTargetBytes,
          residentPages: last.residentPages,
          pagesLoading: last.pagesLoading,
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
      size: { width: canvas.width, height: canvas.height },
    };
  } catch (error) {
    return unsupported(String(error));
  } finally {
    explorer?.dispose();
    canvas.remove();
  }
}
