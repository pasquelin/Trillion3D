// Oracles of the "cut by delta" batch: the previous code, copied as-is. The cut
// readers rewalked the list published by the sample every frame; the bench compares them
// to those that now read only a delta. The copies are wanted duplicates: that is the oracle.
import type {
  PageRec,
  RequestStamps,
} from '../../../packages/sdk-browser/src/page/selection/selection.ts';

/** `packages/sdk-browser/src/webgpu/frame/hold.ts:cutComplete` before the batch: the whole cut reread for a single verdict. */
export function referenceCutComplete(desired: readonly PageRec[]) {
  for (let i = 0; i < desired.length; i++) if (!desired[i].array) return false;
  return true;
}

/** `packages/sdk-browser/src/webgpu/pages/io/hostApi.ts:pendingUrls` before the batch: `collectPendingUrls` on the whole cut. */
export function referencePendingUrls(
  desired: readonly PageRec[],
  stamps: RequestStamps,
  into: string[],
) {
  into.length = 0;
  stamps.begin();
  return stamps.mark(desired, into, true);
}
