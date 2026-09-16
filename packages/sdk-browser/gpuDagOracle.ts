import { frustumExcludesBox, frustumPlanesToLocal } from '../sdk-core/index.ts';
import type { PackedDag } from './gpuDagTypes.ts';
import { DAG_NODE_FLOATS } from './gpuDagTypes.ts';
import { CLUSTER_ROOT, CLUSTER_WORDS, clusterLevel } from './gpuDagLayout.ts';
import type { SelectionUniforms, SelectionResult } from './gpuSelection.ts';
import { dagScratch, projectedError } from './gpuDagOracleMath.ts';
import { createDagOraclePredicates } from './gpuDagOraclePredicates.ts';
import { ESCALATION_ROUNDS, ESCALATION_SLACK } from './pageSelectionTypes.ts';

/**
 * Node oracle for the kernel, in the same shape the shader uses. Not called by the renderer.
 *
 * `cacheCone`: false (default) recomputes coneRejects at every call site, like the oracle always
 * has. true caches it once per page the first time a visible page reaches it — the pageIds loop
 * runs first, so that is always dagWanted's moment — and every later site rereads the same value,
 * like gpuDagShader.ts has done since the lot D5 cache. Both modes must select the same pages: this
 * flag exists only so gpuDagConeCacheEquivalence.test.ts can prove that without forking the kernel.
 */
export function evaluateDagSelectionKernel(
  packed: PackedDag,
  uniforms: SelectionUniforms,
  resident?: Uint32Array,
  cacheCone = false,
) {
  if (resident && resident.length !== packed.pageCount)
    throw new Error('GPU_SELECTION_RESIDENCY_COUNT_CHANGED');
  const { clusters, nodes, worlds, worldStretch } = packed;
  const clusterInts = new Uint32Array(clusters.buffer),
    nodeInts = new Uint32Array(nodes.buffer);
  const cameraStretch = uniforms.cameraStretch ?? 1,
    focal = Math.max(uniforms.pixelScale[0], uniforms.pixelScale[1]),
    near = uniforms.near;
  const pixelError = uniforms.pixelError;
  const planes: Float64Array[] = [],
    views: number[][] = [],
    stretches: number[] = [];
  const { view, world, viewMatrix } = dagScratch;
  view.fromArray(uniforms.view);
  for (let w = 0; w < packed.worldCount; w++) {
    world.fromArray(worlds.subarray(w * 16, w * 16 + 16));
    const object = new Float64Array(24);
    frustumPlanesToLocal(object, uniforms.planes, world.elements);
    planes.push(object);
    viewMatrix.multiplyMatrices(view, world);
    views.push([...viewMatrix.elements]);
    stretches.push(worldStretch[w] * cameraStretch);
  }
  // Descente par niveaux, comme le noyau : un nœud rejeté n'engendre rien, et une feuille jamais
  // atteinte reste rejetée. Un drapeau non nul dit « ne descends pas ici » ; seules les feuilles
  // retenues retombent à zéro, et ce sont elles seules que les grappes consultent.
  const nodeFlags = new Uint8Array(Math.max(1, packed.nodeCount)).fill(1);
  const frontier: number[] = [];
  for (let w = 0; w < packed.worldCount; w++)
    if (packed.rootNodes[w] !== 0xffffffff) frontier.push(packed.rootNodes[w]);
  while (frontier.length) {
    const n = frontier.pop() as number,
      base = n * DAG_NODE_FLOATS,
      w = nodeInts[base + 12];
    if (
      frustumExcludesBox(
        planes[w],
        nodes[base],
        nodes[base + 1],
        nodes[base + 2],
        nodes[base + 4],
        nodes[base + 5],
        nodes[base + 6],
      )
    )
      continue;
    const bound = nodes[base + 7];
    if (
      bound >= 0 &&
      projectedError(
        bound,
        nodes[base + 8],
        nodes[base + 9],
        nodes[base + 10],
        nodes[base + 11],
        views[w],
        stretches[w],
        focal,
        near,
      ) <= pixelError
    ) {
      nodeFlags[n] = 2;
      continue;
    }
    const children = nodeInts[base + 15];
    if (children) {
      for (let c = 0; c < children; c++) frontier.push(nodeInts[base + 3] + c);
      continue;
    }
    nodeFlags[n] = 0;
  }
  const { coneRejects, visible, bandPixels, selects } = createDagOraclePredicates({
    packed,
    uniforms,
    clusterInts,
    nodeFlags,
    planes,
    views,
    stretches,
    focal,
    near,
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
  let frustumRejected = 0,
    lodLevel = 0;
  const thresholds = new Float64Array(Math.max(1, packed.worldCount)).fill(Math.max(pixelError, 0));
  const missing = new Uint8Array(Math.max(1, packed.worldCount));
  for (let i = 0; i < packed.pageCount; i++) {
    const base = i * CLUSTER_WORDS,
      w = clusterInts[base + 10];
    if (!visible(i)) {
      frustumRejected++;
      continue;
    }
    if (!selects(i, pixelError)) continue;
    if (cone(i, w)) continue;
    const level = clusterLevel(clusterInts[base + 11]);
    if (level > lodLevel) lodLevel = level;
    pageIds.push(i);
    if (!resident || resident[i]) continue;
    const parent = bandPixels(i, 1) * ESCALATION_SLACK;
    if (parent > 0 && Number.isFinite(parent)) thresholds[w] = Math.max(thresholds[w], parent);
    else missing[w] = 1;
  }
  const drawablePageIds: number[] = [];
  if (!resident)
    return {
      pageIds,
      frustumRejected,
      lodLevel,
      complete: true,
      drawablePageIds: pageIds.slice(),
    } as SelectionResult;
  for (let round = 0; round < ESCALATION_ROUNDS + 1; round++) {
    let raised = false;
    for (let i = 0; i < packed.pageCount; i++) {
      if (resident[i]) continue;
      const base = i * CLUSTER_WORDS,
        w = clusterInts[base + 10];
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
        const base = i * CLUSTER_WORDS,
          w = clusterInts[base + 10];
        if (visible(i) && selects(i, thresholds[w]) && !cone(i, w)) missing[w] = 1;
      }
  }
  let complete = true;
  for (let i = 0; i < packed.pageCount; i++) {
    const base = i * CLUSTER_WORDS,
      w = clusterInts[base + 10];
    if (!visible(i) || cone(i, w)) continue;
    let draw: boolean;
    if (missing[w]) {
      draw = !!(clusterInts[base + 11] & CLUSTER_ROOT);
      if (draw && !resident[i]) {
        complete = false;
        draw = false;
      }
    } else {
      draw = selects(i, thresholds[w]);
      if (draw && !resident[i]) {
        complete = false;
        draw = false;
      }
    }
    if (draw) drawablePageIds.push(i);
  }
  return { pageIds, frustumRejected, lodLevel, complete, drawablePageIds } as SelectionResult;
}
