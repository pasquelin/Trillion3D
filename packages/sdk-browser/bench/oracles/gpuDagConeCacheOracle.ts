/**
 * Oracle D5 : rejeu du noyau de sélection DAG (`gpuDagOracle.ts`) avec le rejet par cône mis en
 * cache une fois par page visible, comme `dagWanted`/`dagEscalate`/`dagCheck`/`dagMask` le font
 * côté GPU depuis le lot D5 (`gpuDagShader.ts`). `evaluateDagSelectionKernel` (inchangé, importé
 * tel quel) reste l'ancien noyau : il recalcule `coneRejects` à chaque site d'appel. Cette version
 * calcule le rejet une fois pour chaque page que `visible()` retient — exactement l'ordre où
 * `dagWanted` la dépose — puis les trois passes suivantes ne font que relire ce cache. Une lecture
 * pour une page jamais marquée visible lève, ce qui formalise l'invariant du commit : « elles ne le
 * lisent que pour une page visible, la seule pour laquelle il a été écrit ».
 */
import type { PackedDag } from '../../gpuDagTypes.ts';
import {
  CLUSTER_FLOATS,
  DAG_NODE_FLOATS,
  CLUSTER_ROOT,
  DAG_ESCALATION_ROUNDS,
} from '../../gpuDagTypes.ts';
import type { SelectionUniforms, SelectionResult } from '../../gpuSelection.ts';
import { dagScratch, objectPlanes, outsidePlanes, projectedError } from '../../gpuDagOracleMath.ts';
import { createDagOraclePredicates } from '../../gpuDagOraclePredicates.ts';
export function evaluateDagSelectionCached(
  packed: PackedDag,
  uniforms: SelectionUniforms,
  resident?: Uint32Array,
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
    objectPlanes(uniforms, world, object);
    planes.push(object);
    viewMatrix.multiplyMatrices(view, world);
    views.push([...viewMatrix.elements]);
    stretches.push(worldStretch[w] * cameraStretch);
  }
  const nodeFlags = new Uint8Array(Math.max(1, packed.nodeCount));
  for (let n = 0; n < packed.nodeCount; n++) {
    const base = n * DAG_NODE_FLOATS,
      w = nodeInts[base + 12];
    if (
      outsidePlanes(
        planes[w],
        nodes[base],
        nodes[base + 1],
        nodes[base + 2],
        nodes[base + 4],
        nodes[base + 5],
        nodes[base + 6],
      )
    ) {
      nodeFlags[n] = 1;
      continue;
    }
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
    )
      nodeFlags[n] = 2;
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
  // dagWanted : une page visible se voit toujours attribuer une entrée de cache, que la bande de
  // sélection la retienne ou non — c'est cette même page que les trois autres passes relisent.
  const coneCache = new Map<number, boolean>();
  const pageIds: number[] = [];
  let frustumRejected = 0,
    lodLevel = 0;
  for (let i = 0; i < packed.pageCount; i++) {
    if (!visible(i)) {
      frustumRejected++;
      continue;
    }
    const w = clusterInts[i * CLUSTER_FLOATS + 10];
    const rejected = coneRejects(i, w);
    coneCache.set(i, rejected);
    if (!selects(i, pixelError)) continue;
    if (rejected) continue;
    if (clusterInts[i * CLUSTER_FLOATS + 11] > lodLevel)
      lodLevel = clusterInts[i * CLUSTER_FLOATS + 11];
    pageIds.push(i);
  }
  const coneCached = (i: number) => {
    if (!coneCache.has(i))
      throw new Error(
        `cache miss lecture du cone pour la page ${i} : jamais visible dans dagWanted`,
      );
    return coneCache.get(i)!;
  };
  const drawablePageIds: number[] = [];
  if (!resident)
    return {
      pageIds,
      frustumRejected,
      lodLevel,
      complete: true,
      drawablePageIds: pageIds.slice(),
    } as SelectionResult;
  const thresholds = new Float64Array(Math.max(1, packed.worldCount)).fill(Math.max(pixelError, 0));
  const missing = new Uint8Array(Math.max(1, packed.worldCount));
  for (let i = 0; i < packed.pageCount; i++) {
    if (!visible(i) || !selects(i, pixelError)) continue;
    if (coneCached(i)) continue;
    const w = clusterInts[i * CLUSTER_FLOATS + 10];
    if (!resident[i]) {
      const parent = bandPixels(i, 1);
      if (parent > 0 && Number.isFinite(parent)) thresholds[w] = Math.max(thresholds[w], parent);
      else missing[w] = 1;
    }
  }
  for (let round = 0; round < DAG_ESCALATION_ROUNDS + 1; round++) {
    let raised = false;
    for (let i = 0; i < packed.pageCount; i++) {
      if (resident[i]) continue;
      const w = clusterInts[i * CLUSTER_FLOATS + 10];
      if (!visible(i) || !selects(i, thresholds[w]) || coneCached(i)) continue;
      const parent = bandPixels(i, 1);
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
    if (round === DAG_ESCALATION_ROUNDS)
      for (let i = 0; i < packed.pageCount; i++) {
        if (resident[i]) continue;
        const w = clusterInts[i * CLUSTER_FLOATS + 10];
        if (visible(i) && selects(i, thresholds[w]) && !coneCached(i)) missing[w] = 1;
      }
  }
  let complete = true;
  for (let i = 0; i < packed.pageCount; i++) {
    const w = clusterInts[i * CLUSTER_FLOATS + 10];
    if (!visible(i) || coneCached(i)) continue;
    let draw: boolean;
    if (missing[w]) {
      draw = !!(clusterInts[i * CLUSTER_FLOATS + 13] & CLUSTER_ROOT);
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
