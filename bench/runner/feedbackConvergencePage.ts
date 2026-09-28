import type * as Sdk from '../witnesses/measurement.ts';
import type { CameraPose, FrameMetrics } from '../../packages/sdk-core/src/index.ts';
import { posterCapture } from './measurePage.ts';

type Probe = { captureFeedbackAb(): Promise<Uint8Array> };
export type ConvergenceFrame = {
  frame: number;
  held: boolean | null;
  coverageReady: boolean | null;
  selected: number | null;
  drawn: number | null;
  uncovered: number | null;
  pagesLoading: number | null;
  residentPages: number | null;
  shadowPagesPending: number | null;
  shadowPagesDrawn: number | null;
  requested: number | null;
  atLevel: number | null;
  served: number | null;
  pending: number | null;
  deferred: number | null;
  missingLevels: number | null;
  refused: number | null;
};
export type ConvergenceProof = {
  supported: boolean;
  reason: string | null;
  trace: ConvergenceFrame[];
  captures: { frame: number; file: string; final: boolean }[];
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

function traceFrame(metrics: FrameMetrics, frame: number): ConvergenceFrame {
  return {
    frame,
    held: metrics.frameHeld ?? null,
    coverageReady: metrics.coverageReady ?? null,
    selected: metrics.selectedTriangles,
    drawn: metrics.drawnTriangles ?? null,
    uncovered: metrics.uncoveredTriangles ?? null,
    pagesLoading: metrics.pagesLoading ?? null,
    residentPages: metrics.residentPages,
    shadowPagesPending: metrics.shadowPagesPending ?? null,
    shadowPagesDrawn: metrics.shadowPagesDrawn ?? null,
    requested: metrics.textureTilesRequested ?? null,
    atLevel: metrics.textureTilesAtLevel ?? null,
    served: metrics.textureTilesServed ?? null,
    pending: metrics.textureTilesPending ?? null,
    deferred: metrics.textureTilesDeferred ?? null,
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
  let gap = false,
    previousAtLevel = -1,
    previousMissing = Infinity,
    held = false;
  const capture = async (frame: number, final: boolean) => {
    const file = `${prefix}-convergence-${frame}${final ? '-final' : ''}.rgba`;
    const pixels = await backend.captureFeedbackAb();
    const response = await posterCapture(file, pixels, canvas.width, canvas.height);
    if (!response.ok) throw new Error(`FEEDBACK_AB_CAPTURE_${response.status}`);
    captures.push({ frame, file, final });
  };
  for (let i = 0; i < 240; i++) {
    await new Promise<number>((done) => requestAnimationFrame(done));
    const frame = traceFrame(explorer.render(pose), i);
    trace.push(frame);
    const ready = feedbackGeometryReady(frame);
    const missing = frame.missingLevels !== null && frame.missingLevels > 0;
    if (ready && missing) gap = true;
    // Preserve the first textured gap and later improvements; cap large RGBA readbacks.
    if (
      ready &&
      missing &&
      captures.length < 5 &&
      (captures.length === 0 ||
        (frame.atLevel ?? -1) > previousAtLevel ||
        frame.missingLevels! < previousMissing)
    ) {
      await capture(i, false);
      previousAtLevel = frame.atLevel ?? -1;
      previousMissing = frame.missingLevels!;
    }
    if (frame.held === true && ready && textureReady(frame)) {
      await capture(i, true);
      held = true;
      break;
    }
  }
  const reason = !held
    ? 'FEEDBACK_AB_NO_HELD_REFERENCE'
    : !gap || !captures.some((entry) => !entry.final)
      ? 'FEEDBACK_AB_NO_RESIDENT_TEXTURE_GAP'
      : null;
  return { supported: reason === null, reason, trace, captures };
}
