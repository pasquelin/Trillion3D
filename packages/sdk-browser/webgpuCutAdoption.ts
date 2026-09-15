import type { GpuCut, GpuSelection, SelectionUniforms } from './gpuSelection.ts';
import { sameSelectionUniforms } from './gpuSelection.ts';
import type { PageRec } from './pageSelection.ts';
import { shownFromGpu } from './webgpuPagesHelpers.ts';
import type { CutDelta } from './webgpuCutDelta.ts';

function appendPages(target: PageRec[], ...sources: readonly (readonly PageRec[])[]) {
  for (const source of sources) for (let i = 0; i < source.length; i++) target.push(source[i]);
}

/**
 * Applies a completed readback without letting it decide the current-frame draw mask.
 *
 * The readback is taken as a difference: a cut this adopter has already seen enters and leaves no
 * page at all, and a cut that moved names only what moved. `desired` keeps that difference as its
 * opaque head and the transparent cut as its tail, so the steps that follow read a set that survived
 * the previous image rather than one rebuilt from fifteen thousand records.
 */
export function createWebgpuCutAdopter(options: {
  selection: () => GpuSelection | undefined;
  packedPages: PageRec[];
  desired: PageRec[];
  shown: PageRec[];
  drawn: PageRec[];
  drawableScratch: PageRec[];
  uniforms: SelectionUniforms;
  residentOffsetWords: Int32Array;
  delta: CutDelta;
  /** The drawable cut as a difference, kept apart because it is not the cut that was asked for. */
  drawnDelta: CutDelta;
  /** Called once per readback, and only there: the difference is applied exactly once. */
  onCutDelta: (delta: CutDelta) => void;
  onDrawnDelta: (delta: CutDelta) => void;
}) {
  const metrics = {
    ready: false,
    visible: 0,
    selectedTriangles: 0,
    uncoveredTriangles: 0,
    drawnTriangles: 0,
    transparentTriangles: 0,
    frustumRejected: 0,
    lodLevel: 0,
  };
  let lastCut: GpuCut | null = null;
  const adopt = () => {
    const cut = options.selection()?.peek();
    if (!cut?.result.drawablePageIds) return false;
    const { packedPages, desired, shown, drawn, drawableScratch, delta, drawnDelta } = options;
    if (cut === lastCut) {
      delta.hold();
      drawnDelta.hold();
    } else {
      delta.apply(cut.result.pageIds);
      drawnDelta.apply(cut.result.drawablePageIds);
      lastCut = cut;
    }
    // A difference is applied where it is computed. An image that adopts nothing — no readback has
    // landed — must not replay the previous one, which would count every page twice.
    options.onCutDelta(delta);
    options.onDrawnDelta(drawnDelta);
    metrics.visible = desired.length;
    if (!sameSelectionUniforms(cut.uniforms, options.uniforms)) return false;
    if (cut.result.complete === false) throw new Error('GPU_COVERAGE_INCOMPLETE');
    const counts = shownFromGpu(
      packedPages,
      cut.result.drawablePageIds,
      drawableScratch,
      options.residentOffsetWords,
    );
    shown.length = 0;
    appendPages(shown, drawableScratch);
    drawn.length = 0;
    appendPages(drawn, shown);
    metrics.ready = true;
    metrics.selectedTriangles = counts.drawnTriangles;
    metrics.uncoveredTriangles = counts.uncoveredTriangles;
    metrics.drawnTriangles = counts.drawnTriangles;
    metrics.transparentTriangles = counts.transparentTriangles;
    metrics.frustumRejected = cut.result.frustumRejected;
    metrics.lodLevel = cut.result.lodLevel;
    return true;
  };
  /** Forgets the cut held: the CPU cut rewrote the arrays this adopter maintains. */
  const invalidate = () => {
    lastCut = null;
    options.delta.invalidate();
    options.drawnDelta.invalidate();
  };
  return { adopt, metrics, invalidate };
}
