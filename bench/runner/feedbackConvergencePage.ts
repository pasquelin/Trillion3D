import type * as Sdk from '../witnesses/measurement.ts';
import type { CameraPose, FrameMetrics } from '../../packages/sdk-core/src/index.ts';
import { posterCapture } from './measurePage.ts';
import type {
  SpatialFeedback,
  SurfaceKind,
} from '../../packages/sdk-browser/src/webgpu/pages/diagnostic/feedbackSpatial.ts';

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
  order: Record<Scope, Checkpoint>;
};
type Scope = 'all' | SurfaceKind;
/** Center at its requested mip while periphery lags, then periphery at level; `present` when
 *  both regions still request the scope in the held frame. */
type Checkpoint = { centerFirst: number | null; peripheryAtLevel: number | null; present: boolean };
const SCOPES: readonly Scope[] = ['all', 'opaque', 'mask', 'blend'];
const pick = (region: SpatialFeedback['center'], scope: Scope) =>
  scope === 'all' ? region : region.kinds[scope];
const enough = (sample: SpatialFeedback, scope: Scope) =>
  [sample.center, sample.periphery].every(
    (region) => pick(region, scope).requested >= (scope === 'all' ? 64 : 8),
  );

/** Advances each scope's checkpoints on one spatial sample. */
export function orderCheckpoints(
  order: Record<Scope, Checkpoint>,
  sample: SpatialFeedback,
  i: number,
) {
  for (const scope of SCOPES) {
    const at = order[scope];
    if (!enough(sample, scope)) continue;
    const center = pick(sample.center, scope),
      outer = pick(sample.periphery, scope);
    if (
      at.centerFirst === null &&
      center.atLevel === center.requested &&
      outer.atLevel < outer.requested
    )
      at.centerFirst = i;
    else if (
      at.centerFirst !== null &&
      at.peripheryAtLevel === null &&
      outer.atLevel === outer.requested
    )
      at.peripheryAtLevel = i;
  }
}

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
  const order = Object.fromEntries(
    SCOPES.map((scope) => [scope, { centerFirst: null, peripheryAtLevel: null, present: false }]),
  ) as Record<Scope, Checkpoint>;
  let held = false;
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
    const open = SCOPES.some((scope) => order[scope].peripheryAtLevel === null);
    if (ready && (frame.held || (open && spatial.length < 48))) {
      const sample = await backend.feedbackAbSpatial();
      spatial.push({ frame: i, ...sample });
      orderCheckpoints(order, sample, i);
    }
    if (frame.held === true && ready && textureReady(frame)) {
      await capture(i);
      held = true;
      break;
    }
  }
  const final = spatial.find((entry) => entry.frame === captures[0]?.frame);
  for (const scope of SCOPES) order[scope].present = !!final && enough(final, scope);
  const heldMipsReady =
    order.all.present &&
    [final!.center, final!.periphery].every((region) => region.atLevel === region.requested);
  // A surface kind both regions request must show the same center-first order as the frame.
  const unordered = SCOPES.find(
    (scope) =>
      (scope === 'all' || order[scope].present) &&
      (order[scope].centerFirst === null || order[scope].peripheryAtLevel === null),
  );
  const reason = !held
    ? 'FEEDBACK_AB_NO_HELD_REFERENCE'
    : !heldMipsReady
      ? 'FEEDBACK_AB_HELD_MIPS_UNVERIFIED'
      : unordered
        ? `FEEDBACK_AB_NO_CENTER_FIRST_CHECKPOINT${unordered === 'all' ? '' : `_${unordered.toUpperCase()}`}`
        : null;
  return {
    supported: reason === null,
    reason,
    trace,
    captures,
    spatial,
    order,
  };
}
