import type { PackedDag } from '../types.ts';
import { CLUSTER_ROOT, CLUSTER_TRANSPARENT, clusterLevel } from '../layout.ts';
import { bandError, dagRecords, flagsOf, trianglesOf, worldOf } from '../records.ts';
import type { SelectionResult } from '../../core/selection.ts';
import type { DagViewUniforms } from '../types.ts';
import { dagViewFrames } from './math.ts';
import { dagOracleDescent } from './descent.ts';
import { quantizeRequestPriority } from '../request.ts';
import { createDagOraclePredicates } from './predicates.ts';
import { ESCALATION_ROUNDS, ESCALATION_SLACK } from '../../../page/selection/types.ts';

/**
 * Node oracle for the kernel, in the same shape the shader uses. Not called by the renderer.
 *
 * `cacheCone`: false (default) recomputes coneRejects at every call site, like the oracle always
 * has. true caches it once per page the first time a visible page reaches it — the pageIds loop
 * runs first, so that is always dagWanted's moment — and every later site rereads the same value,
 * like ../shader/shader.ts has done since the lot D5 cache. Both modes must select the same pages: this
 * flag exists only so ../coneCacheEquivalence.test.ts can prove that without forking the kernel.
 *
 * `carried`: the previous frame's `finalThresholds`, what `work[slot]` still holds when
 * `resetPrune` opens the frame. Absent, every primitive is fresh.
 */
export function evaluateDagSelectionKernel(
  packed: PackedDag,
  uniforms: DagViewUniforms,
  resident?: Uint32Array,
  cacheCone = false,
  carried?: ArrayLike<number>,
) {
  if (resident && resident.length !== packed.pageCount)
    throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
  // The single decoder of the compact layout: the same one the buffer double rereads, so
  // no field rank is written anywhere but once, in `../layout.ts`.
  const records = dagRecords(packed);
  // The per-primitive prologue and per-node verdict are those of `math.ts`,
  // written once: frontier counting rereads them, and neither it nor the oracle can drift alone.
  const frames = dagViewFrames(packed, uniforms);
  const { planes, views, stretches, focal, near, pixelError } = frames;
  // Descent, mirror of `../shader/levelWgsl.ts`, set aside: it returns each node's verdict
  // and the floor top-down pruning dropped per primitive.
  const { nodeFlags, prunedFloor } = dagOracleDescent(packed, frames, carried);
  const { coneRejects, visible, bandPixels, selects } = createDagOraclePredicates({
    packed,
    records,
    nodeFlags,
    planes,
    views,
    stretches,
    focal,
    near,
    perspective: frames.perspective,
    viewPoint: frames.viewPoint,
    light: uniforms.light,
  });
  const coneCache = cacheCone ? new Map<number, boolean>() : undefined;
  const cone = (i: number, w: number): boolean => {
    if (!coneCache) return coneRejects(i, w);
    const cached = coneCache.get(i);
    if (cached !== undefined) return cached;
    const rejected = coneRejects(i, w);
    coneCache.set(i, rejected);
    return rejected;
  };
  const pageIds: number[] = [];
  /** Priority of each request, at the same rank as `pageIds`: mirror of `quantizePriority`. */
  const priorites: number[] = [];
  // Totals the GPU holds, replayed in the same place: `dagWanted` for the kept cut and its
  // blended share, `dagMask` for what goes to draw and for the hole (`../shader/totalsWgsl.ts`).
  const totaux = { selected: 0, transparent: 0, drawn: 0, uncovered: 0 };
  /** Mirror of `noteImage` (../shader/totalsWgsl.ts): the three totals on the SAME set. */
  const note = (i: number, voulu: boolean, dessinee: boolean, trou: boolean) => {
    if (!voulu) return;
    const tri = trianglesOf(records, i);
    totaux.selected += tri;
    if (flagsOf(records, i) & CLUSTER_TRANSPARENT) totaux.transparent += tri;
    if (dessinee) totaux.drawn += tri;
    if (trou) totaux.uncovered += tri;
  };
  let frustumRejected = 0,
    lodLevel = 0;
  const thresholds = new Float64Array(Math.max(1, packed.worldCount)).fill(Math.max(pixelError, 0));
  const missing = new Uint8Array(Math.max(1, packed.worldCount));
  for (let i = 0; i < packed.pageCount; i++) {
    const w = worldOf(records, i);
    if (!visible(i)) {
      frustumRejected++;
      continue;
    }
    if (!selects(i, pixelError)) continue;
    if (cone(i, w)) continue;
    const level = clusterLevel(flagsOf(records, i));
    if (level > lodLevel) lodLevel = level;
    // Replacement error, or its own when nothing replaces it: `dagWanted` does the same.
    priorites.push(quantizeRequestPriority(bandPixels(i, bandError(records, i, 1) < 0 ? 0 : 1)));
    pageIds.push(i);
    if (!resident || resident[i]) continue;
    const parent = bandPixels(i, 1) * ESCALATION_SLACK;
    if (parent > 0 && Number.isFinite(parent)) thresholds[w] = Math.max(thresholds[w], parent);
    else missing[w] = 1;
  }
  const drawablePageIds: number[] = [];
  // The readout is returned SORTED, decreasing priority, as `parseDagOutput` returns it from the GPU.
  const classe = () => {
    const rangs = pageIds.map((_, i) => i).sort((a, b) => priorites[b] - priorites[a]);
    const pagesTriees = rangs.map((r) => pageIds[r]),
      prioritesTriees = rangs.map((r) => priorites[r]);
    pageIds.length = 0;
    pageIds.push(...pagesTriees);
    priorites.length = 0;
    priorites.push(...prioritesTriees);
  };
  const publie = (drawable: number[], complete: boolean) => (
    classe(),
    {
      pageIds,
      requestPriorities: priorites,
      frustumRejected,
      lodLevel,
      complete,
      drawablePageIds: drawable,
      selectedTriangles: totaux.selected,
      transparentTriangles: totaux.transparent,
      drawnTriangles: totaux.drawn,
      uncoveredTriangles: totaux.uncovered,
      finalThresholds: thresholds,
    } as SelectionResult & { finalThresholds: Float64Array }
  );
  if (!resident) {
    // Without residency, `dagMask` draws everything the cut keeps and digs no hole: the
    // whole drawable cut IS the kept cut.
    for (const i of pageIds) note(i, true, true, false);
    return publie(pageIds.slice(), true);
  }
  for (let round = 0; round < ESCALATION_ROUNDS + 1; round++) {
    let raised = false;
    for (let i = 0; i < packed.pageCount; i++) {
      if (resident[i]) continue;
      const w = worldOf(records, i);
      if (!visible(i) || !selects(i, thresholds[w]) || cone(i, w)) continue;
      const parent = bandPixels(i, 1) * ESCALATION_SLACK;
      if (parent > 0 && Number.isFinite(parent)) {
        if (parent > thresholds[w]) {
          thresholds[w] = parent;
          raised = true;
        }
      } else if (!missing[w]) {
        missing[w] = 1;
        raised = true;
      }
    }
    if (!raised) break;
    if (round === ESCALATION_ROUNDS)
      for (let i = 0; i < packed.pageCount; i++) {
        if (resident[i]) continue;
        const w = worldOf(records, i);
        if (visible(i) && selects(i, thresholds[w]) && !cone(i, w)) missing[w] = 1;
      }
  }
  // A threshold raised above a dropped floor: the coarse levels escalation would need
  // are not candidates, and the primitive falls back on its pinned coverage.
  for (let w = 0; w < thresholds.length; w++) if (thresholds[w] > prunedFloor[w]) missing[w] = 1;
  let complete = true;
  for (let i = 0; i < packed.pageCount; i++) {
    const w = worldOf(records, i);
    if (!visible(i) || cone(i, w)) continue;
    // The branch only decides the CANDIDATE; the residency veto is the same rule for both,
    // and writing it once is what guarantees it stays so.
    let draw = missing[w] ? !!(flagsOf(records, i) & CLUSTER_ROOT) : selects(i, thresholds[w]);
    const trou = draw && !resident[i];
    if (trou) {
      complete = false;
      draw = false;
    }
    note(i, draw || trou, draw, trou);
    if (draw) drawablePageIds.push(i);
  }
  return publie(drawablePageIds, complete);
}
