import type { EngineCamera } from './cameraWorld.ts';
import * as THREE from 'three';
import {
  acceptPageArray,
  collectPendingUrls,
  indexPagesByUrl,
  pageRequestUrl,
  RequestStamps,
  selectVisiblePages,
  type PageRec,
  type ClusterRoot,
} from './pageSelection.ts';
import { orderPendingUrls, pixelScaleOf } from './streamingPriority.ts';
import { applyArrivalPlan, createArrivalSpecs } from './pageArrivalSpecs.ts';
import type { ArrivalPlan } from './pageIntegrationHost.ts';
import { ClusterBatches } from './clusterBatches.ts';

export function createExactPagesRequestData(allPages: PageRec[], requestCount: number) {
  const byUrl = indexPagesByUrl(allPages);
  const pendingScratch: string[] = [],
    urlScratch: string[] = [],
    missingRoots: PageRec[] = [];
  const bundled = allPages.some((rec) => rec.streamUrl !== undefined);
  const requestStamps = new RequestStamps(requestCount);
  const prefetchScratch: string[] = [],
    prefetchShown: PageRec[] = [];
  const pixelScaleScratch: number[] = [1, 1];
  const markRequests = (list: readonly PageRec[]) => {
    for (let i = 0; i < list.length; i++) {
      const rec = list[i];
      if (requestStamps.first(rec.requestIndex)) urlScratch.push(pageRequestUrl(rec));
    }
  };
  return {
    byUrl,
    pendingScratch,
    urlScratch,
    missingRoots,
    bundled,
    requestStamps,
    prefetchScratch,
    prefetchShown,
    pixelScaleScratch,
    markRequests,
  };
}

export type ExactPagesRequestContext = {
  bootstrap: PageRec[];
  missingRoots: PageRec[];
  pendingScratch: string[];
  requestStamps: RequestStamps;
  desired: PageRec[];
  shown: PageRec[];
  viewport: [number, number] | undefined;
  pixelScaleScratch: number[];
  prefetchScratch: string[];
  prefetchShown: PageRec[];
  roots: ReadonlyArray<ClusterRoot<PageRec>>;
  urlScratch: string[];
  bundled: boolean;
  markRequests: (list: readonly PageRec[]) => void;
  batches: ClusterBatches;
  byUrl: Map<string, PageRec[]>;
  indexByUrl: Map<string, THREE.BufferAttribute>;
  disposeGeometry: (geometry: THREE.BufferGeometry) => void;
  scene: THREE.Scene;
  /** La caméra du moteur de la dernière image, absente tant qu'aucune image n'a été rendue. */
  readonly cam: EngineCamera | undefined;
  readonly lastPixelError: number;
  readonly frame: number;
  urlStamp: number;
  /** Prévenu quand des octets de page arrivent ou partent : c'est une écriture de ressources. */
  resourcesChanged: () => void;
};

export function createExactPagesRequests(ctx: ExactPagesRequestContext) {
  const {
    bootstrap,
    missingRoots,
    pendingScratch,
    requestStamps,
    desired,
    shown,
    viewport,
    pixelScaleScratch,
    prefetchScratch,
    prefetchShown,
    roots,
    urlScratch,
    bundled,
    markRequests,
    batches,
    byUrl,
    indexByUrl,
    disposeGeometry,
    scene,
    resourcesChanged,
  } = ctx;
  // Le rang de page de la coupe WebGL vit dans les lots, pas dans une table de pages : la fiche ne
  // porte donc que la place de chaque enregistrement dans le paquet et sa taille.
  const pageSpecs = createArrivalSpecs(byUrl, () => undefined);
  return {
    pageSpecs,
    pendingUrls() {
      // The root cover is requested first and never dropped: it is what the cut falls back on.
      missingRoots.length = 0;
      for (let i = 0; i < bootstrap.length; i++)
        if (!bootstrap[i].array) missingRoots.push(bootstrap[i]);
      if (missingRoots.length)
        return collectPendingUrls(missingRoots, pendingScratch, requestStamps);
      const waiting = desired.length ? desired : shown;
      if (!ctx.cam) return collectPendingUrls(waiting, pendingScratch, requestStamps);
      // Most costly absence first: what the viewer sees wrong the longest is fetched last, not first.
      return orderPendingUrls(
        waiting,
        ctx.cam,
        pixelScaleOf(ctx.cam.projection, viewport, pixelScaleScratch),
        pendingScratch,
      );
    },
    prefetchUrls() {
      prefetchScratch.length = 0;
      if (!ctx.cam || !bootstrap.length) return prefetchScratch;
      // Rien tant que la coupe visible est incomplète. L'anneau se dispute sinon le cache avec ce
      // que l'image montre : la page visible entre, la page de l'anneau la pousse dehors, la coupe
      // retombe sur un remplaçant plus grossier, l'anneau se déplace — et deux couvertures
      // équivalentes se relaient sans fin sur une pose immobile, sans jamais cesser de demander.
      const visible = desired.length ? desired : shown;
      for (let i = 0; i < visible.length; i++) if (!visible[i].array) return prefetchScratch;
      // A ring around the cut: what a twice-finer threshold would select. Asked for only when nothing
      // visible is missing, at a priority the visible cut always outranks.
      const ring = selectVisiblePages(
        roots,
        ctx.cam,
        {
          pixelError: ctx.lastPixelError > 0 ? ctx.lastPixelError * 0.5 : 0.5,
          viewport,
          holdResident: false,
        },
        prefetchShown,
      );
      return collectPendingUrls(ring.wanted?.length ? ring.wanted : ring.shown, prefetchScratch);
    },
    pageUrls() {
      urlScratch.length = 0;
      // A streaming bundle is shared between primitives and instances, so the per-primitive stamp table
      // of the batches cannot deduplicate it. Une estampille par rang de requête le fait sans table de
      // hachage ni allocation, sur une coupe qui compte des milliers de pages à chaque image.
      if (bundled) {
        requestStamps.begin();
        markRequests(bootstrap);
        markRequests(shown);
        markRequests(desired);
        return urlScratch;
      }
      ctx.urlStamp++;
      batches.markUrls(bootstrap, ctx.urlStamp, urlScratch);
      batches.markUrls(shown, ctx.urlStamp, urlScratch);
      batches.markUrls(desired, ctx.urlStamp, urlScratch);
      return urlScratch;
    },
    // One request carries a whole bundle: every record it holds takes the view at its own offset, and
    // each of those views is what the batch writes into the primitive's index buffer.
    acceptPage(url: string, array: Uint32Array, plan?: ArrivalPlan) {
      const recs = byUrl.get(url);
      if (!recs) return;
      // Les vues du paquet viennent du plan calculé hors fil ; sans plan, le même calcul se refait
      // en ligne, au même résultat. Les lots n'écrivent ensuite que les plages ainsi nommées.
      if (!applyArrivalPlan(recs, array, plan)) acceptPageArray(recs, array);
      batches.acceptPage(recs, array);
      resourcesChanged();
    },
    dropPage(url: string) {
      const recs = byUrl.get(url);
      if (!recs) return;
      resourcesChanged();
      batches.dropPage(recs);
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i];
        indexByUrl.delete(rec.url);
        rec.array = undefined;
        rec.indexBytes = rec.triangles * 12;
        if (rec.geometry) {
          disposeGeometry(rec.geometry);
          rec.geometry = undefined;
        }
        if (rec.attached && rec.mesh) {
          scene.remove(rec.mesh);
          rec.attached = false;
        }
        rec.mesh = undefined;
      }
    },
  };
}
