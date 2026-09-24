import { acceptPageArray } from '../../../page/selection/selection.ts';
import { applyArrivalPlan } from '../../../page/integration/arrivalSpecs.ts';
import { pageSourceBytes } from './catalogue.ts';
import { pageAddress } from '../../row/pageSlots.ts';
import type { ArrivalPlan } from '../../../page/integration/host.ts';
import type { PageRec } from '../../../page/selection/selection.ts';
import type { WebgpuPagesCore } from '../runtime.ts';

/**
 * Takes the bytes of one request; each cluster it carries gets its own view at its own offset.
 *
 * The arrival plan — computed off the main thread — already carries those offsets and the page
 * ranks the request stirs, sorted: all that remains here is to post the views and name the pages
 * to the journal. With no plan, the same calculation is redone inline, to the same result.
 *
 * `affectsImage` says whether these clusters can change the image. When it says no, the bytes are
 * kept and the pages named to the journal, but neither the page epoch nor the resource revision
 * moves: a held frame stays held. Without it — the bootstrap cover — the arrival always counts.
 */
export function acceptPage(
  rt: WebgpuPagesCore,
  url: string,
  array: Uint32Array,
  plan?: ArrivalPlan,
  affectsImage?: (recs: readonly PageRec[]) => boolean,
) {
  const { run, diag } = rt,
    { rows } = rt.layout,
    { byUrl, sourceBytes, tracking, bootstrapUrls } = rt.setup;
  run.deferredDrops.delete(url);
  const recs = byUrl.get(url);
  if (!recs) return;
  // One request can carry a whole bundle: each cluster takes the view at its own offset, and that
  // view — not the bundle — is what the GPU cache uploads under the cluster key.
  const planned = applyArrivalPlan(recs, array, plan);
  if (!planned) acceptPageArray(recs, array);
  // The cache reads a cluster's bytes by its address, which twelve placements share: the table by
  // address is what yields them, whichever placement just received them.
  for (let i = 0; i < recs.length; i++) {
    const bytes = pageSourceBytes(recs[i]);
    if (bytes) sourceBytes.set(pageAddress(recs[i]), bytes);
  }
  // Bytes the image draws, queues, waits for or casts a shadow with have arrived: the list of pages
  // still waited for is no longer the previous one, and the next frame must read them.
  if (!affectsImage || affectsImage(recs)) {
    run.pageArrayEpoch++;
    run.gate.resourcesChanged();
  }
  if (planned && plan) for (let i = 0; i < plan.pageCount; i++) rows.touchPage(plan.pages[i]);
  else
    for (let i = 0; i < recs.length; i++) {
      const page = rows.pageIndexOf(recs[i]);
      if (page !== undefined) rows.touchPage(page);
    }
  // The sample is a function, not an object: its three sweeps of the cluster list — a packet holds
  // hundreds — run only if "trace" detail is requested. Built ahead, it cost those sweeps on every
  // arrived page, including when nobody was reading them.
  diag.traceDiagnostic('page-accepted', 'CPU page accepted for GPU residency', () => ({
    frame: run.frame,
    url,
    bytes: array.byteLength,
    clusters: recs.length,
    bootstrap: recs.some((rec) => bootstrapUrls.has(pageAddress(rec))),
    wanted: recs.some((rec) => tracking.wanted.has(tracking.keyOf(rec))),
    pinned: recs.some((rec) => tracking.pinned.has(tracking.keyOf(rec))),
  }));
}

/** Releases one request, unless a cluster it carries is pinned, wanted or part of the bootstrap. */
export function dropPage(rt: WebgpuPagesCore, url: string) {
  const { run, gpu, diag } = rt,
    { rows } = rt.layout,
    { byUrl, sourceBytes, tracking, bootstrapUrls } = rt.setup;
  const recs = byUrl.get(url);
  if (!recs) return;
  // A request is kept whole: dropping it would take away every cluster it carries, so one pinned
  // cluster is enough to refuse or defer the drop.
  if (recs.some((rec) => bootstrapUrls.has(pageAddress(rec)))) {
    diag.traceDiagnostic(
      'page-drop-deferred',
      'Bootstrap page drop ignored to preserve coverage',
      () => ({ frame: run.frame, url, reason: 'bootstrap-pinned' }),
    );
    return;
  }
  const pinned = recs.some((rec) => tracking.pinned.has(tracking.keyOf(rec))),
    wanted = recs.some((rec) => tracking.wanted.has(tracking.keyOf(rec)));
  if (pinned || wanted) {
    run.deferredDrops.add(url);
    diag.traceDiagnostic(
      'page-drop-deferred',
      'Page drop deferred during the coverage transition',
      () => ({
        frame: run.frame,
        url,
        reason: pinned ? 'pinned' : 'wanted',
        pinned,
        wanted,
        deferred: [...run.deferredDrops],
      }),
    );
    return;
  }
  run.deferredDrops.delete(url);
  run.pageArrayEpoch++;
  run.gate.resourcesChanged();
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i],
      page = rows.pageIndexOf(rec);
    rec.array = undefined;
    rec.indexBytes = rec.triangles * 12;
    // A cluster's bytes are what make it drawable the same way as its cache slot: the page is named
    // AFTER the drop, so what rereads it does read the page without bytes.
    if (page !== undefined) rows.touchPage(page);
    const address = pageAddress(rec);
    sourceBytes.delete(address);
    gpu.cache?.unload?.(address);
    tracking.unmarkPinned(tracking.keyOf(rec));
  }
  diag.traceDiagnostic('page-dropped', 'CPU/GPU page released', () => ({
    frame: run.frame,
    url,
    clusters: recs.length,
    reason: 'host-request',
    deferred: false,
  }));
}
