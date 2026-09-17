import type { PackedDag } from './gpuDagTypes.ts';
import { DAG_NODE_FLOATS } from './gpuDagTypes.ts';
import {
  CLUSTER_ROOT,
  CLUSTER_TRANSPARENT,
  clusterLevel,
  dagRecords,
  flagsOf,
  trianglesOf,
  worldOf,
} from './gpuDagLayout.ts';
import type { SelectionUniforms, SelectionResult } from './gpuSelection.ts';
import { dagNodeFloor, dagNodeVerdict, dagViewFrames } from './gpuDagOracleMath.ts';
import { NODE_FIRST_CHILD, NODE_WORLD } from './gpuDagPackNodes.ts';
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
  const { nodes } = packed;
  // Le décodeur unique de la disposition compacte : le même que le double de tampon relit, si bien
  // qu'aucun rang de champ n'est écrit ailleurs qu'une fois, dans `gpuDagLayout.ts`.
  const records = dagRecords(packed),
    nodeInts = new Uint32Array(nodes.buffer);
  // Le prologue par primitive et le verdict par nœud sont ceux de `gpuDagOracleMath.ts`, écrits une
  // seule fois : le comptage de frontière les relit, et ni lui ni l'oracle ne peut dériver seul.
  const frames = dagViewFrames(packed, uniforms);
  const { planes, views, stretches, focal, near, pixelError } = frames;
  // Descente par niveaux, comme le noyau : un nœud rejeté n'engendre rien, et une feuille jamais
  // atteinte reste rejetée. Un drapeau non nul dit « ne descends pas ici » ; seules les feuilles
  // retenues retombent à zéro, et ce sont elles seules que les grappes consultent.
  const nodeFlags = new Uint8Array(Math.max(1, packed.nodeCount)).fill(1);
  // Le plus petit plancher que l'élagage par le haut a écarté, par primitive : au-dessus de lui,
  // l'escalade demanderait un sous-arbre que la descente n'a pas ouvert, et le repli épinglé s'arme.
  const prunedFloor = new Float64Array(Math.max(1, packed.worldCount)).fill(Infinity);
  const frontier: number[] = [];
  for (let w = 0; w < packed.worldCount; w++)
    if (packed.rootNodes[w] !== 0xffffffff) frontier.push(packed.rootNodes[w]);
  while (frontier.length) {
    const n = frontier.pop() as number;
    const children = dagNodeVerdict(frames, nodes, nodeInts, n);
    if (children < 0) {
      nodeFlags[n] = 2;
      continue;
    }
    const floor = dagNodeFloor(frames, nodes, nodeInts, n);
    if (floor > pixelError) {
      const w = nodeInts[n * DAG_NODE_FLOATS + NODE_WORLD];
      if (floor < prunedFloor[w]) prunedFloor[w] = floor;
      nodeFlags[n] = 2;
      continue;
    }
    if (children) {
      const first = nodeInts[n * DAG_NODE_FLOATS + NODE_FIRST_CHILD];
      for (let c = 0; c < children; c++) frontier.push(first + c);
      continue;
    }
    nodeFlags[n] = 0;
  }
  const { coneRejects, visible, bandPixels, selects } = createDagOraclePredicates({
    packed,
    records,
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
  // Les totaux que la carte tient, rejoués au même endroit : `dagWanted` pour la coupe retenue et sa
  // part en mélange, `dagMask` pour ce qui part au dessin et pour le trou (`gpuDagTotalsWgsl.ts`).
  const totaux = { selected: 0, transparent: 0, drawn: 0, uncovered: 0 };
  /** Miroir de `noteImage` (gpuDagTotalsWgsl.ts) : les trois totaux sur le MÊME ensemble. */
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
    pageIds.push(i);
    if (!resident || resident[i]) continue;
    const parent = bandPixels(i, 1) * ESCALATION_SLACK;
    if (parent > 0 && Number.isFinite(parent)) thresholds[w] = Math.max(thresholds[w], parent);
    else missing[w] = 1;
  }
  const drawablePageIds: number[] = [];
  const publie = (drawable: number[], complete: boolean) =>
    ({
      pageIds,
      frustumRejected,
      lodLevel,
      complete,
      drawablePageIds: drawable,
      selectedTriangles: totaux.selected,
      transparentTriangles: totaux.transparent,
      drawnTriangles: totaux.drawn,
      uncoveredTriangles: totaux.uncovered,
    }) as SelectionResult;
  if (!resident) {
    // Sans résidence, `dagMask` dessine tout ce que la coupe retient et ne creuse aucun trou : la
    // coupe dessinable entière EST la coupe retenue.
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
  // Un seuil monté au-dessus d'un plancher écarté : les étages grossiers dont l'escalade aurait
  // besoin ne sont pas candidats, et la primitive retombe sur sa couverture épinglée.
  for (let w = 0; w < thresholds.length; w++) if (thresholds[w] > prunedFloor[w]) missing[w] = 1;
  let complete = true;
  for (let i = 0; i < packed.pageCount; i++) {
    const w = worldOf(records, i);
    if (!visible(i) || cone(i, w)) continue;
    let draw: boolean;
    let trou = false;
    if (missing[w]) {
      draw = !!(flagsOf(records, i) & CLUSTER_ROOT);
      if (draw && !resident[i]) {
        complete = false;
        draw = false;
        trou = true;
      }
    } else {
      draw = selects(i, thresholds[w]);
      if (draw && !resident[i]) {
        complete = false;
        draw = false;
        trou = true;
      }
    }
    note(i, draw || trou, draw, trou);
    if (draw) drawablePageIds.push(i);
  }
  return publie(drawablePageIds, complete);
}
