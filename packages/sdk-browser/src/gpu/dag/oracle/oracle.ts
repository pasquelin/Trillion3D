import type { PackedDag } from '../types.ts';
import { CLUSTER_TRANSPARENT, clusterLevel } from '../layout.ts';
import { bandError, dagRecords, flagsOf, trianglesOf, worldOf } from '../records.ts';
import type { SelectionResult } from '../../core/selection.ts';
import type { DagViewUniforms } from '../types.ts';
import { dagViewFrames } from './math.ts';
import { dagOracleDescent } from './descent.ts';
import { quantizeRequestPriority } from '../request.ts';
import { createDagOraclePredicates } from './predicates.ts';
import type { drawsCluster } from '../../../page/cut/rule.ts';

/** The cut rule's residency, one entry per page (`../readiness.ts`). */
export type DagCutResidency = { ready: ArrayLike<number>; childReady: ArrayLike<number> };

/**
 * Node oracle for the kernel, in the same shape the shader uses. Not called by the renderer.
 *
 * `cacheCone`: false (default) recomputes coneRejects at every call site, like the oracle always
 * has. true caches it once per page the first time a visible page reaches it — the pageIds loop
 * runs first, so that is always dagWanted's moment — and every later site rereads the same value,
 * like ../shader/shader.ts has done since the lot D5 cache. Both modes must select the same pages: this
 * flag exists only so ../coneCacheEquivalence.test.ts can prove that without forking the kernel.
 *
 * `rule`: the cut rule applied, `drawsCluster` by default; the rule's tests pass its WGSL text run
 * in Node (`../../../page/cut/cutRule.test.ts`), so the kernel's own rule is driven too.
 */
export function evaluateDagSelectionKernel(
  packed: PackedDag,
  uniforms: DagViewUniforms,
  resident?: DagCutResidency,
  cacheCone = false,
  rule?: typeof drawsCluster,
) {
  if (
    resident &&
    (resident.ready.length !== packed.pageCount || resident.childReady.length !== packed.pageCount)
  )
    throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
  // The single decoder of the compact layout: the same one the buffer double rereads, so
  // no field rank is written anywhere but once, in `../layout.ts`.
  const records = dagRecords(packed);
  // The per-primitive prologue and per-node verdict are those of `math.ts`,
  // written once: frontier counting rereads them, and neither it nor the oracle can drift alone.
  const frames = dagViewFrames(packed, uniforms);
  const { planes, views, stretches, focal, near, pixelError } = frames;
  // Descent, mirror of `../shader/levelWgsl.ts`, set aside: it returns each node's verdict.
  const nodeFlags = dagOracleDescent(packed, frames);
  const { coneRejects, visible, bandPixels, draws } = createDagOraclePredicates({
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
    rule,
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
  // Totals the GPU holds, replayed where `dagMask` notes them (`../shader/totalsWgsl.ts`).
  const totaux = { drawn: 0, transparent: 0 };
  const note = (i: number) => {
    const tri = trianglesOf(records, i);
    totaux.drawn += tri;
    if (flagsOf(records, i) & CLUSTER_TRANSPARENT) totaux.transparent += tri;
  };
  let frustumRejected = 0,
    lodLevel = 0;
  for (let i = 0; i < packed.pageCount; i++) {
    const w = worldOf(records, i);
    if (!visible(i)) {
      frustumRejected++;
      continue;
    }
    if (!draws(i, pixelError, true, true)) continue;
    if (cone(i, w)) continue;
    const level = clusterLevel(flagsOf(records, i));
    if (level > lodLevel) lodLevel = level;
    // Replacement error, or its own when nothing replaces it: `dagWanted` does the same.
    priorites.push(quantizeRequestPriority(bandPixels(i, bandError(records, i, 1) < 0 ? 0 : 1)));
    pageIds.push(i);
  }
  // `dagMask`: the cut rule on every live cluster — visible, not rejected by its cone. Without
  // residency every cluster and every finer group is held, and the drawn cut is the kept one.
  const drawablePageIds: number[] = [];
  for (let i = 0; i < packed.pageCount; i++) {
    const w = worldOf(records, i);
    if (!visible(i) || cone(i, w)) continue;
    const ready = !resident || !!resident.ready[i],
      childReady = !resident || !!resident.childReady[i];
    if (!draws(i, pixelError, ready, childReady)) continue;
    note(i);
    drawablePageIds.push(i);
  }
  // The readout is returned SORTED, decreasing priority, as `parseDagOutput` returns it from the GPU.
  const rangs = pageIds.map((_, i) => i).sort((a, b) => priorites[b] - priorites[a]);
  return {
    pageIds: rangs.map((r) => pageIds[r]),
    requestPriorities: rangs.map((r) => priorites[r]),
    frustumRejected,
    lodLevel,
    drawablePageIds,
    selectedTriangles: totaux.drawn,
    transparentTriangles: totaux.transparent,
    drawnTriangles: totaux.drawn,
  } as SelectionResult;
}
