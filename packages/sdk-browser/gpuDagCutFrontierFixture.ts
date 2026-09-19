/**
 * What the descent is made of, frame by frame: its FRONTIER — the nodes where it stops, kept
 * leaf or rejected subtree — and the INTERNAL nodes it walks to get there.
 *
 * That is the measurement that decides persistent selection. A cut kept from one frame to the
 * next can only save the internals: the frontier itself must be re-examined every frame, because
 * each node's screen error changes as soon as the camera moves. In a tree with `b` children the
 * internals equal `frontier / (b-1)`, and that is therefore the ceiling of what exact persistence
 * can return. A rejected node is the only one that can close back onto its parent — both
 * rejections are monotone downward, so a rejected parent rejects its whole subtree, and
 * conversely a kept node necessarily has a kept parent, which is useless to test.
 *
 * It also counts the other half of the problem: TOP-DOWN rejection. The node carries the
 * replacement error CEILING from the manifest — enough to reject a too-fine subtree — and, since
 * this batch, the own-error FLOOR, which `cullingBounds` derives from the pages at prepare time
 * and `packCullingNodes` stores in the node: enough to reject the too-coarse as well, as the
 * CPU cut already does (`pageSelectionCutNode.ts`). Nothing from the compiler, nothing from the
 * format. Both descents are launched from here so the difference is measured, not deduced.
 */
import { DAG_NODE_FLOATS, type PackedDag } from './gpuDagTypes.ts';
import { dagNodeFloor, dagNodeVerdict, dagViewFrames, projectedError } from './gpuDagOracleMath.ts';
import { bandError, bandSphere, dagRecords, worldOf } from './gpuDagLayout.ts';
import { NODE_FIRST_CHILD, NODE_FIRST_PAGE, NODE_PAGE_COUNT } from './gpuDagPackNodes.ts';
import type { SelectionUniforms } from './gpuSelection.ts';

export type Descente = {
  visites: number;
  internes: number;
  frontiereFeuilles: number;
  frontiereRejetees: number;
  candidats: number;
  /** Nodes the subtree error FLOOR rejected, when `plancher` is requested. */
  plancherCoupe: number;
  /** Candidates that are actually too coarse, page by page: what top-down rejection AIMS AT. */
  tropGrossieres: number;
};

/**
 * The kernel descent, replayed verdict for verdict (`gpuDagLevelWgsl.ts`, `levelStep`), and
 * counted. It does not produce a cut — the oracle already does — but says what each frame
 * rereads, and in what form.
 *
 * `plancher` adds TOP-DOWN rejection and actually does it: the caller launches both descents
 * and subtracts. Counting a rejected node's subtree would overestimate the difference — lower
 * rejections, frustum and ceiling, already drop pages the descent would never have listed. The
 * floor is read in the PACKED NODE, where the GPU reads it: packing is therefore measured with
 * it.
 */
export function descenteComptee(
  packed: PackedDag,
  uniforms: SelectionUniforms,
  plancher = false,
): Descente {
  const { nodes } = packed;
  const ints = new Uint32Array(nodes.buffer);
  // The per-primitive prologue and the per-node verdict come from `gpuDagOracleMath.ts`, written
  // once for the oracle and for this count: neither can drift from the kernel alone.
  const frames = dagViewFrames(packed, uniforms);
  const compte: Descente = {
    visites: 0,
    internes: 0,
    frontiereFeuilles: 0,
    frontiereRejetees: 0,
    candidats: 0,
    plancherCoupe: 0,
    tropGrossieres: 0,
  };
  const records = dagRecords(packed);
  let file: number[] = [];
  for (const racine of packed.rootNodes) if (racine !== 0xffffffff) file.push(racine);
  while (file.length) {
    const suivante: number[] = [];
    for (const n of file) {
      compte.visites++;
      const enfants = dagNodeVerdict(frames, nodes, ints, n);
      if (enfants < 0) {
        compte.frontiereRejetees++;
        continue;
      }
      // The subtree error FLOOR, which the node does not yet carry as it carries its ceiling:
      // none of its clusters is fine enough, so no candidate will come out of it.
      if (plancher && dagNodeFloor(frames, nodes, ints, n) > frames.pixelError) {
        compte.plancherCoupe++;
        compte.frontiereRejetees++;
        continue;
      }
      if (enfants) {
        compte.internes++;
        const premier = ints[n * DAG_NODE_FLOATS + NODE_FIRST_CHILD];
        for (let c = 0; c < enfants; c++) suivante.push(premier + c);
        continue;
      }
      compte.frontiereFeuilles++;
      const at = n * DAG_NODE_FLOATS;
      compte.candidats += ints[at + NODE_PAGE_COUNT];
      // What top-down rejection aims at: a cluster whose own error still exceeds the threshold
      // is too coarse, the cut will not take it, and the descent listed it anyway.
      for (let p = 0; p < ints[at + NODE_PAGE_COUNT]; p++) {
        const i = ints[at + NODE_FIRST_PAGE] + p,
          w = worldOf(records, i),
          sphere = bandSphere(records, i, 0);
        if (
          projectedError(
            bandError(records, i, 0),
            records.hot[sphere],
            records.hot[sphere + 1],
            records.hot[sphere + 2],
            records.hot[sphere + 3],
            frames.views[w],
            frames.stretches[w],
            frames.focal,
            frames.near,
          ) > frames.pixelError
        )
          compte.tropGrossieres++;
      }
    }
    file = suivante;
  }
  return compte;
}
