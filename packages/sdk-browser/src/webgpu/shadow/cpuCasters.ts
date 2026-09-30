import { type EngineCamera } from '../../camera/world.ts';
import { selectVisiblePages } from '../../page/selection/selection.ts';
import { MAX_SHADOW_RUNS } from '../../gpu/shadow/batchBudget.ts';
import { planImageShadows } from '../pages/render/encodeShadows.ts';
import { forEachShadowBatch } from '../pages/render/encodeShadowBatches.ts';
import { writeShadowPages } from './pages.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { faceEngineCamera } from './faceCamera.ts';
import { createCpuCasterLists } from './cpuCasterLists.ts';

/** The casters' rows, written from the packed ranks this cut publishes (`./cpuCasterRows.ts`). */
export { writeCpuCasters } from './cpuCasterRows.ts';

/**
 * The CPU cut's shadow casters: each redrawn face's pages, every batch's, then the same as
 * page-table rows at their own place in one buffer, with one indirect command per face. Allocated
 * at the first CPU light cut, sized by the catalogue; the per-face offsets, lengths and commands
 * hold the faces of the most batches a frame draws (`MAX_SHADOW_RUNS`, `batchBudget.ts`) from the
 * start and never grow. The rows' buffer grows to the next power of two a frame needs.
 */
export type CpuCasterLists = ReturnType<typeof createCpuCasterLists>;

/** A list of casters for each of `runs` faces: never more than `MAX_SHADOW_RUNS`, what the
 *  offsets and commands hold. */
function holdRuns(lists: CpuCasterLists, runs: number) {
  if (runs > MAX_SHADOW_RUNS) throw new Error(`${runs} shadow faces, at most ${MAX_SHADOW_RUNS}`);
  while (lists.shown.length < runs) {
    lists.shown.push([]);
    lists.wanted.push([]);
    lists.shownPacked.push([]);
    lists.wantedPacked.push([]);
  }
}

/**
 * Under the CPU cut, the casters of each redrawn face — every batch's the frame draws — are
 * selected FROM THE LIGHT by that same cut: the face's view, its texels, its redrawn pages,
 * residency held, the cone off. Returns the pages none of the camera's rows already draws — they
 * take rows behind the camera's — and hands what the faces asked for to the lower residency tier.
 */
export function selectCpuCasters(rt: WebgpuPagesRuntime, device: GPUDevice, cam: EngineCamera) {
  const { lights, run, services, layout } = rt,
    { runs } = lights,
    { rows } = layout;
  if (!lights.cull || !planImageShadows(rt, cam)) return undefined;
  const pageCount = rows.residentOffsetWords.length;
  if (!lights.cpuCasters || lights.cpuCasters.marks.length !== pageCount) {
    lights.cpuCasters?.source.destroy();
    lights.cpuCasters?.indirect.destroy();
    lights.cpuCasters = createCpuCasterLists(device, pageCount);
  }
  const lists = lights.cpuCasters,
    { casters, castersPacked, marks, shown, wanted, shownPacked, wantedPacked, camera, viewport } =
      lists,
    recordOf = layout.recordOf;
  casters.length = castersPacked.length = 0;
  const stamp = run.frame >>> 0 || 1;
  // The drawn instances as the packed ranks the camera's cut published (#1235): one record serves
  // every placement of its primitive, so the address's first rank no longer names the drawn one.
  for (let i = 0; i < run.drawn.length; i++) {
    const page = run.drawnPacked[i];
    if (page >= 0) marks[page] = stamp;
  }
  lists.runs = 0;
  // Nothing loads or leaves while the faces select — what they want is offered after the last —:
  // the cache's changes reach the cut's residency once, before the first.
  services.syncResidency();
  forEachShadowBatch(rt, (from, to, runBase) => {
    writeShadowPages(lights, cam.eye, from, to);
    lists.runs = runBase + runs.count;
    holdRuns(lists, lists.runs);
    for (let r = 0; r < runs.count; r++) {
      const face = runs.list[r],
        at = runBase + r;
      const selected = selectVisiblePages(
        rt.setup.roots,
        faceEngineCamera(face, camera, viewport),
        {
          pixelError: face.uniforms.pixelError,
          viewport,
          held: services.heldResidency,
          wanted: wanted[at],
          result: lists.result,
          light: face.pages,
        },
        shown[at],
      );
      // The face keeps its WHOLE cut by rank (`kept`, parallel to `shown[at]`): the caster buffer
      // `writeCpuCasters` fills draws every one of them. `casters` holds only the pages no row
      // already draws — the extras `syncRowsFromCut` gives shadow-only rows to.
      // The packed buffer is the whole capacity: its live ranks are those of the face's record
      // lists, rank by rank (`shown`/`wanted`), never the stale tail behind them.
      const ids = selected.shownPacked,
        kept = shownPacked[at];
      kept.length = 0;
      for (let k = 0; k < selected.shown.length; k++) {
        const page = ids[k];
        if (page < 0) continue;
        kept.push(page);
        if (marks[page] === stamp) continue;
        marks[page] = stamp;
        const rec = recordOf(page);
        if (rec) {
          casters.push(rec);
          castersPacked.push(page);
        }
      }
      const asked = selected.wantedPacked,
        wantedIds = wantedPacked[at];
      wantedIds.length = 0;
      for (let k = 0; k < selected.wanted.length; k++) wantedIds.push(asked[k]);
    }
    return true;
  });
  services.shadowTier.offerPages(wantedPacked, lists.runs);
  return casters;
}
