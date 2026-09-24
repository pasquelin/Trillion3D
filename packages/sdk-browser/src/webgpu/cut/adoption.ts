import type { GpuCut, GpuSelection, SelectionUniforms } from '../../gpu/core/selection.ts';
import { sameSelectionUniforms } from '../../gpu/core/selection.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { copyPages } from '../pages/helpers.ts';
import type { CutDelta } from './delta.ts';
import type { CutCounts } from './counts.ts';

/**
 * Applies a completed readback without letting it decide the current-frame draw mask.
 *
 * The readback is taken as a difference: a cut this adopter has already seen enters and leaves no
 * page at all, and a cut that moved names only what moved. `desired` IS that difference's list — one
 * catalogue for one cut, opaque and transparent mixed — so the stages that follow read a set that
 * survived the previous frame, not a rebuilt set.
 */
export function createWebgpuCutAdopter(options: {
  selection: () => GpuSelection | undefined;
  desired: PageRec[];
  shown: PageRec[];
  drawn: PageRec[];
  uniforms: SelectionUniforms;
  /** Totals of the drawable cut, held by the difference: they are read, never resommed. */
  counts: CutCounts;
  delta: CutDelta;
  /** The drawable cut as a difference, kept apart because it is not the cut that was asked for. */
  drawnDelta: CutDelta;
  /** Records this difference writes: `shown` is a copy of them, when the frame adopts it. */
  drawnPages: readonly PageRec[];
  /** Called once per readback, and only there: the difference is applied exactly once. */
  onCutDelta: () => void;
  onDrawnDelta: () => void;
  /** Called when `drawn` has just been remade from `shown`: the frame no longer has to remake it. */
  onDrawnMirrored: () => void;
}) {
  const metrics = {
    /** True when the frame reread the shown list it already held: `desired` and `shown` are those of
     *  the previous frame, at the same ranks. False by default, and false as soon as a doubt exists. */
    cutHeld: false,
    /** True when this adoption actually rewrote `desired` or `shown`. Adoption does not happen only
     *  at render: a drain replays one after the fact, so every reader of these lists must know they
     *  moved under it, not only that the current frame held them. */
    listsRewritten: false,
    /** True when the adopted shown list declares incomplete coverage: a page the kernel wants to
     *  draw has not arrived yet. The frame WAITS for that page, it does not drop GPU selection —
     *  the CPU fallback is reserved for a real selection failure. */
    incomplete: false,
    /** True when the adopted shown list is TRUNCATED: the cut did not fit under the shown-list
     *  ceiling. No difference is taken from it — a truncated list would exit pages that are still
     *  in the cut — and the frame goes back through the CPU cut, the only one that knows how to
     *  pick a representable subset. */
    truncated: false,
    ready: false,
    visible: 0,
    selectedTriangles: 0,
    uncoveredTriangles: 0,
    /** Share of the cut that goes to draw: `selectedTriangles` minus the hole. */
    drawnTriangles: 0,
    transparentTriangles: 0,
    frustumRejected: 0,
    lodLevel: 0,
  };
  let lastCut: GpuCut | null = null;
  /** Shown list `shown` and `drawn` are made from, or `null` when they come from elsewhere. */
  let shownCut: GpuCut | null = null;
  /** Age of the drawable id sequence: it advances every time a shown list publishes another one,
   *  adopted or not. `shownSeq` is that of the sequence `shown` is actually made from: a shown list
   *  applied then rejected — different uniforms, incomplete coverage — separates them, and that is
   *  what forbids holding `shown` on a sequence the frame never adopted. */
  let drawnSeq = 0,
    shownSeq = -1;
  const adopt = () => {
    metrics.cutHeld = false;
    metrics.listsRewritten = false;
    metrics.incomplete = false;
    metrics.truncated = false;
    const selection = options.selection(),
      cut = selection?.peek();
    if (!cut?.result.drawablePageIds) return false;
    // Before any difference: a truncated list describes less than the cut, and the difference taken
    // from it would EXIT pages the cut still holds.
    if (cut.result.truncated) {
      metrics.truncated = true;
      return false;
    }
    const { desired, shown, drawn, delta, drawnDelta } = options;
    if (cut === lastCut) {
      delta.hold();
      drawnDelta.hold();
    } else {
      delta.apply(cut.result.pageIds);
      drawnDelta.apply(cut.result.drawablePageIds);
      lastCut = cut;
    }
    if (drawnDelta.changed) drawnSeq++;
    // A difference is applied where it is computed. An image that adopts nothing — no readback has
    // landed — must not replay the previous one, which would count every page twice.
    options.onCutDelta();
    options.onDrawnDelta();
    metrics.listsRewritten = delta.changed || drawnDelta.changed;
    // A cut from poses a placement has left since draws and counts as a camera's late cut does —
    // the frame's own mask decides the draw —, but no image is held on it: the next readback,
    // cut under the poses in place, may still ask for pages.
    metrics.cutHeld = !metrics.listsRewritten && cut.worldRevision === selection?.worldRevision;
    metrics.visible = desired.length;
    if (!sameSelectionUniforms(cut.uniforms, options.uniforms)) return false;
    if (cut.result.complete === false) {
      metrics.incomplete = true;
      return false;
    }
    // `shown` is a function of the drawable id sequence alone: a new shown list that republishes
    // the SAME sequence `shown` is made from yields the same records, at the same ranks, and neither
    // `shown` nor its copy `drawn` is remade. The comparison is on the age of the adopted sequence,
    // not on the last applied difference: a shown list applied then rejected advanced the age
    // without writing anything. A null `shownCut` means these lists come from elsewhere.
    const held = cut === shownCut || (shownCut !== null && shownSeq === drawnSeq);
    if (!held) {
      // The difference has just written these records by reading the sequence once; rereading them a
      // second time in the catalogue, at sparse ranks, would yield exactly the same array.
      copyPages(shown, options.drawnPages);
      copyPages(drawn, shown);
      options.onDrawnMirrored();
      shownCut = cut;
      shownSeq = drawnSeq;
    }
    // GPU FIRST. It counted the triangles where the verdict is given, in `dagMask`, and shipped
    // them in the shown-list header (`../../gpu/dag/shader/totalsWgsl.ts`): they describe the cut, not the list
    // that reports it. The CPU sum now serves only what has no GPU — the `adoptCpuCut` fallback —
    // and that is the only case where the header does not carry them.
    const gpu = cut.result.selectedTriangles;
    const counts = gpu === undefined ? options.counts.totals : cut.result;
    metrics.ready = true;
    metrics.selectedTriangles = counts.selectedTriangles ?? 0;
    metrics.uncoveredTriangles = counts.uncoveredTriangles ?? 0;
    metrics.drawnTriangles = counts.drawnTriangles ?? 0;
    metrics.transparentTriangles = counts.transparentTriangles ?? 0;
    metrics.frustumRejected = cut.result.frustumRejected;
    metrics.lodLevel = cut.result.lodLevel;
    return true;
  };
  /**
   * Forgets the held shown list: another cut wrote the arrays this adopter maintains. The
   * differences themselves are not dropped — whoever wrote those arrays published them through
   * them, and dropping them would re-request a cut the cache already holds.
   */
  const forgetReadback = () => {
    lastCut = null;
    shownCut = null;
    shownSeq = -1;
  };
  return { adopt, metrics, forgetReadback };
}
