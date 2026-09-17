import { acceptPageArray } from './pageSelection.ts';
import { applyArrivalPlan } from './pageArrivalSpecs.ts';
import { pageSourceBytes } from './webgpuPagesCatalogue.ts';
import type { ArrivalPlan } from './pageIntegrationHost.ts';
import type { WebgpuPagesCore } from './webgpuPagesRuntime.ts';

/**
 * Takes the bytes of one request; each cluster it carries gets its own view at its own offset.
 *
 * Le plan de l'arrivée — calculé hors du fil principal — porte déjà ces offsets et les rangs de
 * page que la requête remue, triés : il ne reste ici qu'à poser les vues et à nommer les pages au
 * journal. Sans plan, le même calcul se refait en ligne, au même résultat.
 */
export function acceptPage(
  rt: WebgpuPagesCore,
  url: string,
  array: Uint32Array,
  plan?: ArrivalPlan,
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
  // Le cache lit les octets d'un cluster par son adresse, que douze placements partagent : la table
  // par adresse est ce qui les lui rend, quel que soit le placement qui vient de les recevoir.
  for (let i = 0; i < recs.length; i++) {
    const bytes = pageSourceBytes(recs[i]);
    if (bytes) sourceBytes.set(recs[i].url, bytes);
  }
  // Des octets sont arrivés : la liste des pages encore attendues n'est plus celle d'avant.
  run.pageArrayEpoch++;
  run.gate.resourcesChanged();
  if (planned && plan) for (let i = 0; i < plan.pageCount; i++) rows.touchPage(plan.pages[i]);
  else
    for (let i = 0; i < recs.length; i++) {
      const page = rows.pageIndexOf(recs[i]);
      if (page !== undefined) rows.touchPage(page);
    }
  // Le relevé est une fonction, pas un objet : ses trois balayages de la liste des clusters — un
  // paquet en porte des centaines — ne s'exécutent que si le détail « trace » est demandé. Construit
  // d'avance, il coûtait ces balayages à chaque page arrivée, y compris quand personne ne les lisait.
  diag.traceDiagnostic('page-accepted', 'Page CPU acceptée pour résidence GPU', () => ({
    frame: run.frame,
    url,
    bytes: array.byteLength,
    clusters: recs.length,
    bootstrap: recs.some((rec) => bootstrapUrls.has(rec.url)),
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
  if (recs.some((rec) => bootstrapUrls.has(rec.url))) {
    diag.traceDiagnostic(
      'page-drop-deferred',
      'Abandon de page bootstrap ignoré pour préserver la couverture',
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
      'Abandon de page différé pendant la transition de couverture',
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
    // Les octets d'un cluster sont ce qui le rend dessinable au même titre que sa place en cache :
    // la page est nommée APRÈS l'abandon, pour que ce qui la relit y lise bien la page sans octets.
    if (page !== undefined) rows.touchPage(page);
    sourceBytes.delete(rec.url);
    gpu.cache?.unload?.(rec.url);
    tracking.unmarkPinned(tracking.keyOf(rec));
  }
  diag.traceDiagnostic('page-dropped', 'Page CPU/GPU libérée', () => ({
    frame: run.frame,
    url,
    clusters: recs.length,
    reason: 'host-request',
    deferred: false,
  }));
}
