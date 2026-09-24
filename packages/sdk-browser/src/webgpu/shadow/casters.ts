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
 * The frame's shadow casters, selected FROM THE LIGHT: each redrawn view — a sun level or a lamp
 * face — has its own cut, and the regions of that view cull only what its cut kept.
 *
 * Under the GPU cut, every view's cut is ONE run of the camera's kernels over all the frame's
 * views (`../../gpu/dag/lightCut.ts`), then ONE cull pass over every region, each reading its
 * view's range of the cut's drawn log straight (`../../gpu/shadow/lightCull.ts`): no list is
 * compacted between the two, since the regions draw one command each whatever a cluster's bin.
 * The cut's streaming requests ride back in one copy, read after submission.
 *
 * Under the CPU cut, the same selection has already run on the CPU (`cpuCasters.ts`), and each
 * face's list waits at its own place in one buffer: only the region cull runs here.
 *
 * Returns false when a resource the frame needs is missing: the caller then reissues the pages.
 */
export function encodeShadowCasters(
  rt: WebgpuPagesRuntime,
  encoder: GPUCommandEncoder,
  regions: number,
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
  // More views than the device holds in one cut — the frame planned before the cut bounded its
  // views (`redrawShortPages`): the pages are reissued, under that bound from the next frame.
  if (light && runs.count > light.capacity) return false;
  if (light) {
    const map = gpuDraw.lightRows(light.pageCount);
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
    lightSource.refreshRows = (pass) => map.encode(pass, rows);
    cull.encodeLight(encoder, lightSource, regions, rows);
    lights.lightRuns = runs.count;
    // Every slot still being read: this frame's requests are not copied, and its coarse pages are
    // drawn again rather than left waiting on them.
    const settle = light.reports.encodeReadback(encoder);
    if (settle) timing.shadowRequests = settle;
    const { list, count } = lights.plan.admission;
    const redraw = runs.count
      ? light.redraws.encode(encoder, list, pageViews, count, settle !== undefined)
      : undefined;
    if (redraw) timing.shadowRedraws = redraw;
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
    source.base = lists.bases[r];
    source.indirectBase = r * 4;
    cull.encode(encoder, source, r, face.first, face.count, lists.lengths[r]);
  }
  lights.lightRuns = runs.count;
  return true;
}

/**
 * Before a plan: the pages a light cut drew short go stale again, whole — residency having moved
 * (`residencyMoved`) and the camera rested when that is what they waited for —, and the views a
 * frame may draw in follow the cut's limit (`../../gpu/dag/lightCutRedraws.ts`); without a light
 * cut, nothing limits them. The pages themselves are the budget's alone (`admit.ts`).
 */
export function redrawShortPages(
  rt: WebgpuPagesRuntime,
  frame: number,
  nowMs: number,
  residencyMoved: boolean,
) {
  const { plan } = rt.lights,
    redraws = rt.lights.lightCut?.redraws;
  if (!redraws) {
    plan.admission.setViewLimit(Infinity);
    return;
  }
  if (residencyMoved) redraws.residencyChanged();
  if (plan.resting) redraws.rest();
  const { pool } = plan;
  const pages = redraws.takeRedraw((page) => {
    if (pool.owner[page] >= 0) pool.stale(page, nowMs, frame, STALE_FULL);
  });
  plan.admission.setViewLimit(redraws.viewLimit);
  if (pages)
    rt.diag.engineDiagnostic('light-cut-redraw', 'Pages the light cut drew short, drawn again', {
      pages,
      viewLimit: redraws.viewLimit,
    });
}
