import { acceptPageArray } from './pageSelection.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

/** Takes the bytes of one request; each cluster it carries gets its own view at its own offset. */
export function acceptPage(rt: WebgpuPagesRuntime, url: string, array: Uint32Array) {
  const { run, diag } = rt,
    { byUrl, sourceBytes, tracking, bootstrapUrls } = rt.setup;
  run.deferredDrops.delete(url);
  const recs = byUrl.get(url);
  if (!recs) return;
  // One request can carry a whole bundle: each cluster takes the view at its own offset, and that
  // view — not the bundle — is what the GPU cache uploads under the cluster key.
  acceptPageArray(recs, array);
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i],
      view = rec.array!;
    sourceBytes.set(rec.url, new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
  }
  diag.traceDiagnostic('page-accepted', 'Page CPU acceptée pour résidence GPU', {
    frame: run.frame,
    url,
    bytes: array.byteLength,
    clusters: recs.length,
    bootstrap: recs.some((rec) => bootstrapUrls.has(rec.url)),
    wanted: recs.some((rec) => tracking.wantedStamp[tracking.keyOf(rec)] === tracking.wantedEpoch),
    pinned: recs.some((rec) => tracking.pinnedAt[tracking.keyOf(rec)] >= 0),
  });
}

/** Releases one request, unless a cluster it carries is pinned, wanted or part of the bootstrap. */
export function dropPage(rt: WebgpuPagesRuntime, url: string) {
  const { run, gpu, diag } = rt,
    { byUrl, sourceBytes, tracking, bootstrapUrls } = rt.setup;
  const recs = byUrl.get(url);
  if (!recs) return;
  // A request is kept whole: dropping it would take away every cluster it carries, so one pinned
  // cluster is enough to refuse or defer the drop.
  if (recs.some((rec) => bootstrapUrls.has(rec.url))) {
    diag.traceDiagnostic(
      'page-drop-deferred',
      'Abandon de page bootstrap ignoré pour préserver la couverture',
      { frame: run.frame, url, reason: 'bootstrap-pinned' },
    );
    return;
  }
  const pinned = recs.some((rec) => tracking.pinnedAt[tracking.keyOf(rec)] >= 0),
    wanted = recs.some((rec) => tracking.wantedStamp[tracking.keyOf(rec)] === tracking.wantedEpoch);
  if (pinned || wanted) {
    run.deferredDrops.add(url);
    diag.traceDiagnostic(
      'page-drop-deferred',
      'Abandon de page différé pendant la transition de couverture',
      {
        frame: run.frame,
        url,
        reason: pinned ? 'pinned' : 'wanted',
        pinned,
        wanted,
        deferred: [...run.deferredDrops],
      },
    );
    return;
  }
  run.deferredDrops.delete(url);
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    rec.array = undefined;
    rec.indexBytes = rec.triangles * 12;
    sourceBytes.delete(rec.url);
    gpu.cache?.unload?.(rec.url);
    tracking.unmarkPinned(tracking.keyOf(rec));
  }
  diag.traceDiagnostic('page-dropped', 'Page CPU/GPU libérée', {
    frame: run.frame,
    url,
    clusters: recs.length,
    reason: 'host-request',
    deferred: false,
  });
}
