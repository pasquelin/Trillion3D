import type { WebgpuPagesCore } from '../pages/runtime.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { dropPage } from '../pages/io/pageApi.ts';
import { createWebgpuPinUpdater } from './pinUpdater.ts';
import { createRequestPins } from './requestPins.ts';
import type { WebgpuResidencySets } from './sets.ts';

/**
 * The two pin steps, one per cut: the CPU cut's pins by last use (`pinUpdater.ts`), the GPU cut's
 * what it admitted (`requestPins.ts`, #836). The queue says when one takes over from the other
 * (`queue.ts`): the GPU cut's then sets the pins to its queue once, and the CPU cut's starts
 * afresh, every kept key joining (`pinFeed.ts`).
 */
export function createWebgpuPinSteps(
  rt: WebgpuPagesCore,
  sets: WebgpuResidencySets,
  parentsOf: (rec: PageRec) => readonly PageRec[],
) {
  const { run, gpu, diag } = rt,
    { tracking, bootstrapUrls, bootstrapKey, byUrl } = rt.setup;
  const options = {
    tracking,
    sets,
    bootstrapUrls,
    bootstrapKey,
    deferredDrops: run.deferredDrops,
    byUrl,
    parentsOf,
    traceEnabled: diag.traceEnabled,
    traceDiagnostic: diag.traceDiagnostic,
  };
  const drop = (key: string) => dropPage(rt, key);
  const request = createRequestPins(options);
  let cpu = createWebgpuPinUpdater(options);
  return {
    cpu(fresh: boolean) {
      if (fresh) cpu = createWebgpuPinUpdater(options);
      cpu(gpu.cache, run.shown, run.frame, drop);
    },
    gpu: (resync: boolean) => request(gpu.cache, resync, drop),
  };
}
