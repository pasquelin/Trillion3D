import type { GpuSelection, SelectionUniforms } from './gpuSelection.ts';
import { sameSelectionUniforms } from './gpuSelection.ts';
import type { PageRec } from './pageSelection.ts';
import { partitionByPass, shownFromGpu, triangleSum } from './webgpuPagesHelpers.ts';

function appendPages(target: PageRec[], ...sources: readonly (readonly PageRec[])[]) {
  for (const source of sources) for (let i = 0; i < source.length; i++) target.push(source[i]);
}

/** Applies a completed readback without letting it decide the current-frame draw mask. */
export function createWebgpuCutAdopter(options: {
  selection: () => GpuSelection | undefined;
  packedPages: PageRec[];
  desired: PageRec[];
  shown: PageRec[];
  drawn: PageRec[];
  wanted: PageRec[];
  transparentScratch: PageRec[];
  drawableScratch: PageRec[];
  uniforms: SelectionUniforms;
  residentOffsetWords: Int32Array;
  frame: () => number;
}) {
  const metrics = {
    ready: false,
    visible: 0,
    selectedTriangles: 0,
    uncoveredTriangles: 0,
    drawnTriangles: 0,
    frustumRejected: 0,
    lodLevel: 0,
  };
  const adopt = () => {
    const cut = options.selection()?.peek();
    if (!cut?.result.drawablePageIds) return false;
    const { packedPages, desired, shown, drawn, wanted, transparentScratch, drawableScratch } =
      options;
    wanted.length = 0;
    for (const id of cut.result.pageIds) {
      const rec = packedPages[id];
      if (rec) wanted.push(rec);
    }
    partitionByPass(desired, true, transparentScratch);
    desired.length = 0;
    appendPages(desired, wanted, transparentScratch);
    if (!sameSelectionUniforms(cut.uniforms, options.uniforms)) return false;
    if (cut.result.complete === false) throw new Error('GPU_COVERAGE_INCOMPLETE');
    const counts = shownFromGpu(
      packedPages,
      cut.result.drawablePageIds,
      options.frame(),
      drawableScratch,
      options.residentOffsetWords,
    );
    partitionByPass(shown, true, transparentScratch);
    shown.length = 0;
    appendPages(shown, drawableScratch, transparentScratch);
    drawn.length = 0;
    appendPages(drawn, shown);
    metrics.ready = true;
    metrics.visible = desired.length;
    metrics.selectedTriangles = triangleSum(shown);
    metrics.uncoveredTriangles = counts.uncoveredTriangles;
    metrics.drawnTriangles = counts.drawnTriangles;
    metrics.frustumRejected = cut.result.frustumRejected;
    metrics.lodLevel = cut.result.lodLevel;
    return true;
  };
  return { adopt, metrics };
}
