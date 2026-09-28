import type * as Sdk from '../witnesses/measurement.ts';
import type { CameraPose, FrameMetrics } from '../../packages/sdk-core/src/index.ts';
import { posterCapture } from './measurePage.ts';
import type { SpatialFeedback } from '../../packages/sdk-browser/src/webgpu/pages/diagnostic/feedbackSpatial.ts';

type Probe = {
  captureFeedbackAb(): Promise<Uint8Array>;
  feedbackAbSpatial(): Promise<SpatialFeedback>;
};
export type ConvergenceFrame = ReturnType<typeof traceFrame>;
export type ConvergenceProof = {
  supported: boolean;
  reason: string | null;
  trace: ConvergenceFrame[];
  captures: { frame: number; file: string; final: boolean }[];
  spatial: (SpatialFeedback & { frame: number })[];
  centerBeforePeriphery: number | null;
  peripheryAtLevel: number | null;
};

export const feedbackGeometryReady = (frame: ConvergenceFrame) =>
  frame.coverageReady === true &&
  frame.pagesLoading === 0 &&
  frame.selected !== null &&
  frame.selected > 0 &&
  frame.drawn !== null &&
  frame.selected === frame.drawn;
const textureReady = (frame: ConvergenceFrame) =>
  frame.pending === 0 &&
  frame.missingLevels === 0 &&
  frame.requested !== null &&
  frame.requested === frame.atLevel;

function traceFrame(metrics: FrameMetrics, frame: number) {
  return {
    frame,
    held: metrics.frameHeld ?? null,
    coverageReady: metrics.coverageReady ?? null,
    selected: metrics.selectedTriangles,
    drawn: metrics.drawnTriangles ?? null,
    pagesLoading: metrics.pagesLoading ?? null,
    residentPages: metrics.residentPages,
    requested: metrics.textureTilesRequested ?? null,
    atLevel: metrics.textureTilesAtLevel ?? null,
    pending: metrics.textureTilesPending ?? null,
    missingLevels: metrics.textureMissingLevels ?? null,
    refused: metrics.textureTilesRefused ?? null,
  };
}

/** Samples ordinary budgeted frames; no flush or convergence barrier runs between captures. */
export async function captureConvergence(
  explorer: Sdk.MeasuredWorld,
  backend: Probe,
  pose: CameraPose,
  prefix: string,
  canvas: HTMLCanvasElement,
): Promise<ConvergenceProof> {
  const trace: ConvergenceFrame[] = [];
  const captures: ConvergenceProof['captures'] = [];
  const spatial: ConvergenceProof['spatial'] = [];
  let centerBeforePeriphery: number | null = null,
    peripheryAtLevel: number | null = null,
    held = false;
  const capture = async (frame: number) => {
    const file = `${prefix}-convergence-${frame}-final.rgba`;
    const pixels = await backend.captureFeedbackAb();
    const response = await posterCapture(file, pixels, canvas.width, canvas.height);
    if (!response.ok) throw new Error(`FEEDBACK_AB_CAPTURE_${response.status}`);
    captures.push({ frame, file, final: true });
  };
  for (let i = 0; i < 240; i++) {
    await new Promise<number>((done) => requestAnimationFrame(done));
    const frame = traceFrame(explorer.render(pose), i);
    trace.push(frame);
    const ready = feedbackGeometryReady(frame);
    if (ready && (frame.held || (peripheryAtLevel === null && spatial.length < 48))) {
      const sample = await backend.feedbackAbSpatial();
      spatial.push({ frame: i, ...sample });
      const center = sample.center,
        outer = sample.periphery;
      if (center.requested >= 64 && outer.requested >= 64) {
        if (
          centerBeforePeriphery === null &&
          center.atLevel === center.requested &&
          outer.atLevel < outer.requested
        )
          centerBeforePeriphery = i;
        else if (centerBeforePeriphery !== null && outer.atLevel === outer.requested)
          peripheryAtLevel = i;
      }
    }
    if (frame.held === true && ready && textureReady(frame)) {
      await capture(i);
      held = true;
      break;
    }
  }
  const final = spatial.find((entry) => entry.frame === captures[0]?.frame);
  const heldMipsReady =
    !!final &&
    [final.center, final.periphery].every(
      (region) => region.requested >= 64 && region.atLevel === region.requested,
    );
  const reason = !held
    ? 'FEEDBACK_AB_NO_HELD_REFERENCE'
    : !heldMipsReady
      ? 'FEEDBACK_AB_HELD_MIPS_UNVERIFIED'
      : centerBeforePeriphery === null || peripheryAtLevel === null
        ? 'FEEDBACK_AB_NO_CENTER_FIRST_CHECKPOINT'
        : null;
  return {
    supported: reason === null,
    reason,
    trace,
    captures,
    spatial,
    centerBeforePeriphery,
    peripheryAtLevel,
  };
}
