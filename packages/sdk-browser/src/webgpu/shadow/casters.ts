import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { lightCutOf } from '../../gpu/dag/selection.ts';
import type { ShadowCullSource } from '../../gpu/shadow/cull.ts';
import type { ShadowLightSource } from '../../gpu/shadow/lightCull.ts';
import {
  SHADOW_CULL_FLOATS,
  SHADOW_CULL_VIEW,
} from '../../../../sdk-core/src/scene/light-shadow/faces.ts';
import { pageViews } from './pages.ts';
import { STALE_FULL } from '../../../../sdk-core/src/scene/light-shadow/pool.ts';

/** Where the current face's list lies, rewritten face by face: a frame allocates no record. */
const source = {} as ShadowCullSource;
/** What the GPU light cut's cull reads, rewritten each frame. */
const lightSource = {} as ShadowLightSource;

/**
 * One batch's shadow casters — pages `[from, to)` of the frame's list, the runs of the batches
 * before it at `runBase` —, selected FROM THE LIGHT: each redrawn view — a sun level or a lamp face
 * — has its own cut, and the regions of that view cull only what its cut kept.
 *
 * Under the GPU cut, every view's cut is ONE run of the camera's kernels over all the frame's
 * views (`../../gpu/dag/lightCut.ts`), then ONE cull pass over every region, each reading its
 * view's range of the cut's drawn log straight (`../../gpu/shadow/lightCull.ts`): no list is
 * compacted between the two, since the regions draw one command each whatever a cluster's bin.
 * The cuts of every batch append their streaming requests to one list, copied once after the
 * frame's last batch (`encodeShadowRequests`) and read after submission.
 *
 * Under the CPU cut, the same selection has already run on the CPU (`cpuCasters.ts`), and each
 * face's list waits at its own place in one buffer, every batch's: only the region cull runs here.
 *
 * Returns false when a resource the frame needs is missing: the caller then reissues the pages.
 */
export function encodeShadowCasters(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  regions: number,
  from: number,
  to: number,
  runBase: number,
) {
  const { lights, vis, run, layout, setup, timing } = rt,
    { cull, spheres, runs, mobilityRows } = lights,
    { gpuDraw } = vis;
  if (!cull || !spheres || !gpuDraw || !mobilityRows) return false;
  const rows = layout.rows.packedCount;
  // A frame on the CPU cut leaves the light cut as it is: its waiting pages, its redraws and its
  // reports belong to the GPU selection, which only a drop takes away (`../pages/io/drops.ts`).
  const selection = run.gpuFrameActive ? run.gpuSelection : undefined;
  const light = selection && lightCutOf(selection);
  if (light) lights.lightCut = light;
  // A batch holds no more views than its cut runs at once (`encodeShadowBatches.ts`).
  if (light && runs.count > light.capacity) return false;
  if (light) {
    const map = gpuDraw.lightRows(light.pageCount);
    // The blended casters' rows are no draw record's: their pages are pinned in the map instead.
    rt.services.blendCasters.pin(map);
    // Each region reads its own view's range of the one log the cut writes.
    for (let r = 0; r < runs.count; r++) {
      const { first, count } = runs.list[r];
      for (let region = first; region < first + count; region++)
        cull.volumeWords[region * SHADOW_CULL_FLOATS + SHADOW_CULL_VIEW] = r;
    }
    cull.begin(regions, setup.maxCorners);
    if (runs.count) light.encode(encoder, runs.list, runs.count);
    lightSource.spheres = spheres.buffer;
    lightSource.mobility = mobilityRows;
    lightSource.items = gpuDraw.itemsBuffer;
    lightSource.rowOf = map.rowOf;
    lightSource.log = light.drawnLog;
    lightSource.blendFirst = layout.rows.blendFirst;
    lightSource.blendEnd = layout.rows.casterSlots;
    lightSource.refreshRows = (pass) => map.encode(pass, rows);
    cull.encodeLight(encoder, lightSource, regions, rows);
    lights.lightRuns += runs.count;
    // The frame's requests are copied once, after its last batch (`encodeShadowRequests`): every
    // report slot still being read, they will not be, and the coarse pages are drawn again rather
    // than left waiting on them.
    const list = lights.plan.admission.list.subarray(from, to);
    const redraw = runs.count
      ? light.redraws.encode(encoder, list, pageViews, to - from, light.reports.hasRoom)
      : undefined;
    if (redraw) timing.shadowRedraws = both(timing.shadowRedraws, redraw);
    return true;
  }
  cull.begin(regions, setup.maxCorners);
  const lists = lights.cpuCasters;
  if (run.gpuFrameActive || !lists || lists.frame !== run.frame) return false;
  source.mobility = mobilityRows;
  source.spheres = spheres.buffer;
  source.source = lists.source;
  source.indirect = lists.indirect;
  source.commands = 1;
  for (let r = 0; r < runs.count; r++) {
    const face = runs.list[r];
    source.base = lists.bases[runBase + r];
    source.indirectBase = (runBase + r) * 4;
    cull.encode(encoder, source, r, face.first, face.count, lists.lengths[runBase + r]);
  }
  lights.lightRuns += runs.count;
  return true;
}

/** Once the frame's batches are encoded: the requests every batch's light cut appended, in one
 *  copy (`../../gpu/dag/lightCut.ts`). */
export function encodeShadowRequests(rt: WebgpuPagesRuntime, encoder: GPUCommandEncoder) {
  const { timing } = rt,
    settle = rt.lights.lightCut?.encodeReports(encoder);
  if (settle) timing.shadowRequests = both(timing.shadowRequests, settle);
}

/** The settlements of every batch's readbacks, called in turn once the command buffer is. */
const both =
  (first: ((submitted: boolean) => void) | undefined, next: (submitted: boolean) => void) =>
  (submitted: boolean) => {
    first?.(submitted);
    next(submitted);
  };

/**
 * Before a plan: the pages a light cut drew short go stale again, whole — residency having moved
 * (`residencyMoved`) and the camera rested when that is what they waited for, withdrawn meanwhile
 * only when they miss casters (`../../gpu/dag/lightCutRedraws.ts`) —, and the plan draws them in
 * the frame, with every other stale page the image reads (`admit.ts`).
 */
export function redrawShortPages(
  rt: WebgpuPagesRuntime,
  frame: number,
  nowMs: number,
  residencyMoved: boolean,
) {
  const { plan } = rt.lights,
    redraws = rt.lights.lightCut?.redraws;
  if (!redraws) return;
  if (residencyMoved) redraws.residencyChanged();
  if (plan.resting) redraws.rest();
  const { pool } = plan;
  const pages = redraws.takeRedraw((page, withdraw) => {
    if (pool.owner[page] < 0) return;
    pool.stale(page, nowMs, frame, STALE_FULL);
    if (withdraw) pool.withdraw(plan.table, page);
  });
  if (pages)
    rt.diag.engineDiagnostic('light-cut-redraw', 'Pages the light cut drew short, drawn again', {
      pages,
      viewLimit: redraws.viewLimit,
    });
}
