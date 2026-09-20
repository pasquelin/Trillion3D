import type { EngineCamera } from './cameraWorld.ts';
import * as THREE from 'three';
import {
  acceptPageArray,
  collectPendingUrls,
  indexPagesByUrl,
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
  batches: ClusterBatches;
  byUrl: Map<string, PageRec[]>;
  indexByUrl: Map<string, THREE.BufferAttribute>;
  disposeGeometry: (geometry: THREE.BufferGeometry) => void;
  scene: THREE.Scene;
  /** Engine camera of the last frame, absent as long as no frame has been rendered. */
  readonly cam: EngineCamera | undefined;
  readonly lastPixelError: number;
  readonly frame: number;
  urlStamp: number;
  /** Notified when page bytes arrive or leave: that is a resource write. */
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
    batches,
    byUrl,
    indexByUrl,
    disposeGeometry,
    scene,
    resourcesChanged,
  } = ctx;
  // The WebGL cut's page rank lives in batches, not in a page table: the record therefore
  // only carries the position of each entry in the bundle and its size.
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
      // Nothing while the visible cut is incomplete. Otherwise the ring fights the cache with
      // what the frame shows: the visible page enters, the ring page pushes it out, the cut
      // falls back on a coarser substitute, the ring moves — and two equivalent covers take
      // turns forever on a still pose, never stopping asking.
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
      // of the batches cannot deduplicate it. One stamp per request rank does it without a hash
      // table or allocation, on a cut that counts thousands of pages every frame.
      if (bundled) {
        requestStamps.begin();
        requestStamps.mark(bootstrap, urlScratch);
        requestStamps.mark(shown, urlScratch);
        requestStamps.mark(desired, urlScratch);
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
      // Packet views come from the plan computed off-thread; without a plan, the same compute
      // is redone inline, to the same result. Batches then write only the ranges thus named.
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
