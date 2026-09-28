/**
 * THE WEBGPU PATH GROWS AN INSTANCE BUFFER IN PLACE (`growth.ts`), within the page table it opened
 * with. The new rows' roots and pages are appended to every list the session reads by rank — the
 * cut's roots, the packed catalogue, the per-page residency arrays, the placement worlds, the
 * temporal pass's previous poses, the shadow mobility, the root boxes —, each page with the pool
 * slot its address already holds: no slot is uploaded, no texture tile moved, no residency lost.
 *
 * The page table itself does not move: a growth is taken when a session opened on the grown scene
 * would hold the same table (`askedTableRows`), so the image is the one that session draws. The GPU
 * cut, the transparent table and the forward copies lay their own tables out at open (#483): a
 * growth they read is refused, as is one past the table, and the owner opens the session again.
 */
import { askedTableRows, countCopies } from '../webgpu/pages/prepare/layout.ts';
import { reserveRootBoxes } from '../math/batchBoxes.ts';
import { mainViewGpu, viewGpu } from '../webgpu/pages/state/view.ts';
import { forgetRootsByMesh } from '../webgpu/pages/render/movedNode.ts';
import { pageRequestUrl } from '../page/selection/requests.ts';
import type { WebgpuPagesRuntime } from '../webgpu/pages/runtime.ts';
import { growRowRoots } from './growth.ts';
import { placedBy, type PlacementRows } from './rows.ts';

/** Whether the session grows each of `from` to `capacity` rows in place, asked before any is. */
export function webgpuGrowsInPlace(
  rt: WebgpuPagesRuntime,
  from: readonly PlacementRows[],
  capacity: number,
) {
  const { layout, run, gpu, setup, blendState } = rt;
  if (!gpu.device || run.lost || run.gpuSelection) return false;
  // The placements each pool address would feed: the grown buffers' addresses alone move.
  const copies = { byAddress: new Map(layout.copies.byAddress), max: layout.copies.max };
  let opaque = layout.opaquePageCount;
  for (const buffer of from) {
    if (placedBy(setup.blendCopies, buffer) || placedBy(blendState.blendGpu, buffer)) return false;
    const template = layout.selectionRoots.find((root) => root.placement?.rows === buffer);
    if (!template) continue;
    if (template.pages[0]?.transparent) return false;
    const more = capacity - buffer.capacity;
    opaque += more * template.pages.length;
    countCopies(copies, template.pages, more);
  }
  const { rows } = layout,
    blended = layout.packedPages.length - layout.opaquePageCount,
    asked = askedTableRows(opaque, blended, setup.cap, copies.max, rt.context.gpuDevice?.limits);
  return (
    asked.drawSlots <= layout.drawSlots && asked.blendSlots === rows.casterSlots - rows.blendFirst
  );
}

/**
 * Steps 1 to 3 of the contract (`growth.ts`) on a growth `webgpuGrowsInPlace` took: the roots of
 * `from` read `to`, and each new row's parked root joins the lists at the next rank, its pages at
 * the end of the catalogue.
 */
export function growWebgpuPlacements(
  rt: WebgpuPagesRuntime,
  from: PlacementRows,
  to: PlacementRows,
) {
  const { layout, setup, services, run } = rt,
    { selectionRoots, packedPages, rows } = layout;
  const first = packedPages.length;
  for (const { item: root } of growRowRoots(selectionRoots, from, to)) {
    for (const page of root.pages) {
      page.placementIndex = selectionRoots.length;
      packedPages.push(page);
      setup.allPages.push(page);
      setup.byUrl.get(pageRequestUrl(page))?.push(page);
    }
    countCopies(layout.copies, root.pages);
    selectionRoots.push(root);
    setup.roots.push(root);
  }
  if (packedPages.length === first) return;
  layout.opaquePageCount += packedPages.length - first;
  rows.addPages(first);
  const worlds = new Float32Array(selectionRoots.length * 16);
  worlds.set(layout.worldUpdates);
  layout.worldUpdates = worlds;
  rt.lights.mobility.ensure(
    selectionRoots.length,
    rows.casterSlots,
    (rank) => selectionRoots[rank].world.elements,
  );
  mainViewGpu(rt).temporal?.motion.grow();
  for (const view of rt.views.persistent) viewGpu(rt, view).temporal?.motion.grow();
  services.heldResidency.track(selectionRoots);
  forgetRootsByMesh(selectionRoots);
  reserveBoxes(rt);
  // New sources to watch, and every world walked again at the next image.
  run.gate.sceneChanged();
}

/** The root boxes' batch for the longer list: the one held no longer plays (`transformRootBoxes`),
 *  and the moved boxes are reprojected one by one, to the same bits, until the new one is ready. */
function reserveBoxes(rt: WebgpuPagesRuntime) {
  const { layout, signal } = rt;
  layout.rootBoxes?.release();
  layout.rootBoxes = null;
  const roots = layout.selectionRoots.length;
  void reserveRootBoxes(layout.selectionRoots).then(
    (lot) => {
      if (signal.aborted || layout.rootBoxes || layout.selectionRoots.length !== roots)
        lot?.release();
      else layout.rootBoxes = lot;
    },
    () => {},
  );
}
