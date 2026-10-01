import { boxEmpty } from '../../../../sdk-core/src/index.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import type { Placements } from '../../page/selection/placements.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { FLAG_MASK, PAGE_INFO_STRIDE } from '../../visibility/types.ts';
import { ROW_FLAGS_WORD, ROW_INDEX_WORDS } from '../row/pageRow.ts';
import { mobilityRows } from './rowBuffers.ts';
import { growClusterBox } from './spheres.ts';

export { growClusterBox, packClusterSpheres, uploadClusterSpheres } from './spheres.ts';

const ROW_WORDS = PAGE_INFO_STRIDE / 4;

/**
 * Mobility word of rows `[from, to]` — whether its placement moves, whether it is a cutout, whether
 * a finer resident form stands for it (#831), the corners its row draws (#966) — pushed on the same
 * dirty interval as the spheres and the page table's flags — a row whose cut readiness moved is
 * marked too (`gpuCutStream.ts`) —, and every row once when a placement turns moving: what the
 * page cull splits a page's casters by, static layer or moving casters, and drawn with no fragment
 * stage or with the cutout test (#965).
 */
export function uploadRowMobility(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  from: number,
  to: number,
) {
  const { lights, layout } = rt,
    { rows, selectionRoots, placement } = layout,
    { casterSlots } = rows;
  const { mobility } = lights;
  mobility.ensure(
    selectionRoots.length,
    casterSlots,
    (rank) => selectionRoots[rank].world.elements,
  );
  if (!lights.mobilityRows || lights.mobilityRows.size !== mobility.rowWords.byteLength) {
    lights.mobilityRows?.destroy();
    lights.mobilityRows = mobilityRows(device, mobility.rowWords.length);
    from = 0;
    to = casterSlots - 1;
  }
  const buffer = lights.mobilityRows,
    ints = rows.pageTableInts,
    selection = rt.run.gpuSelection,
    // A row the table does not hold yet is sized as the scene's largest: never a triangle short.
    corners = (row: number) => ints?.[row * ROW_WORDS + ROW_INDEX_WORDS] ?? rt.setup.maxCorners;
  mobility.writeRows(
    (row) => (rows.packedRecs[row] ? placement.rootOfPacked[rows.packedPageIndex[row]] : -1),
    casterSlots,
    from,
    to,
    (first, count) => device.queue.writeBuffer(buffer, first * 4, mobility.rowWords, first, count),
    corners,
    rows.blendFirst,
    (row) => !!ints && (ints[row * ROW_WORDS + ROW_FLAGS_WORD] & FLAG_MASK) !== 0,
    (row) =>
      !!selection && !!rows.packedRecs[row] && !selection.isFinest(rows.packedPageIndex[row]),
  );
}

/** Two flat world boxes and their halves, allocated once, that a change is declared with: the
 *  rows the static layer holds, then the rows already moving. */
export const changeBoxes = [0, 1].map(() => {
  const box = new Float64Array(6);
  return { box, min: box.subarray(0, 3), max: box.subarray(3, 6) };
});

/** True when the placement of rank `rank` already moves: the static layer does not hold its
 *  casters, and a change of its own redraws the moving casters alone (#993). */
export const recordMoves = ({ mobility }: WebgpuLightState, rank: number) =>
  rank >= 0 && mobility.moves(rank);

/**
 * A page entered residency or left it since the last plan: the scene is drawn at another
 * precision where it is, so the shadow maps of lights whose range touches this box
 * no longer describe it exactly and become candidates again. Without that, a settled map would
 * keep the shadow of a cluster that left, or ignore that of a cluster that arrived (#159). A
 * residency change the cut reads (`atOnce`) stales its pages at the next plan, the camera moving
 * or not (#831): a page kept with a superseded form of a surface shades the form the camera now
 * draws in patches. Another change of the representation waits for the camera to rest. The
 * declared box is that of the cluster's world sphere; a moving placement's, or a blended
 * caster's (`moving`), leaves the static layer as it is.
 */
export function noteResidenceChange(
  lights: WebgpuLightState,
  roots: Placements,
  rootOfPacked: Int32Array,
  packed: number,
  rec: PageRec,
  moving?: boolean,
  atOnce = false,
) {
  const { store, plan } = lights;
  if (!store.count) return;
  const rank = rootOfPacked[packed] ?? -1;
  const onlyMoving = moving ?? recordMoves(lights, rank);
  const { box, min, max } = changeBoxes[+onlyMoving];
  boxEmpty(box, 0);
  growClusterBox(rec, roots, box, rank);
  if (atOnce) plan.residencyChanged(min, max, onlyMoving);
  else plan.representationChanged(min, max, onlyMoving);
}
