import { MAX_SHADOW_PAGES } from '../../../gpu/shadow/atlas.ts';
import { shadowBatchWrites } from '../../../gpu/shadow/batchWrites.ts';
import { SHADOW_PAGES_PER_FRAME } from '../../../gpu/shadow/batchBudget.ts';
import { frameBatchCapacity } from './frameBatchCapacity.ts';
import { pageModes, writeShadowPages } from '../../shadow/pages.ts';
import { encodeShadowAtlas } from './encodeShadowPass.ts';
import { encodeShadowRequests } from '../../shadow/casters.ts';
import { recordShadowEncoding } from '../../shadow/cpuSteps.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { WebgpuLightState } from '../state/lights.ts';

/**
 * Hands every batch of the frame's pages to `visit` — pages `[from, to)` of the plan's list, and
 * the runs of the batches before it —, in order, until it returns false. Returns where it stopped:
 * the frame's page count when every batch was visited.
 *
 * At most the frame's capacity (`frameBatchCapacity`): the current pool's pages in the fewest
 * pages a batch holds, within the memory grant. More than `MAX_SHADOW_BATCHES` full batches stale
 * at once, or a view limit bisected after a light cut dropped work, needs more; the pages past the
 * last are then pending, drawn the next frame; so are those past the frame's page budget
 * (`SHADOW_PAGES_PER_FRAME`), a batch at most past it. An empty list visits no batch.
 */
export function forEachShadowBatch(
  rt: WebgpuPagesRuntime,
  visit: (from: number, to: number, runBase: number) => boolean,
  { views, batches } = frameBatchCapacity(rt),
) {
  const { plan, runs } = rt.lights,
    { admission } = plan,
    count = admission.count;
  let runBase = 0,
    from = 0;
  for (let batch = 0; from < count && from < SHADOW_PAGES_PER_FRAME && batch < batches; batch++) {
    const to = admission.batchEnd(from, MAX_SHADOW_PAGES, views);
    if (!visit(from, to, runBase)) break;
    runBase += runs.count;
    from = to;
  }
  return from;
}

/**
 * THE FRAME'S SHADOW PAGES, EVERY ONE, IN THE FRAME THAT MARKS THEM. The plan lists every stale page
 * the image reads (`admit.ts`); the per-batch buffers hold `MAX_SHADOW_PAGES` pages and one light
 * cut's views, so the list is drawn batch after batch in the frame's command buffer, each batch's
 * writes landing in command order (`../../../gpu/shadow/batchWrites.ts`), and each batch's pages
 * committed once encoded. Nothing is deferred to a later frame: a batch that cannot be encoded — a
 * resource missing — leaves its pages and the rest stale, pending, for the next frame.
 *
 * Returns whether every page was encoded.
 */
export function encodeShadowBatches(
  rt: WebgpuPagesRuntime,
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  eye: ArrayLike<number>,
) {
  const started = performance.now(),
    { lights } = rt,
    { plan } = lights,
    count = plan.admission.count,
    writes = shadowBatchWrites(device),
    capacity = frameBatchCapacity(rt);
  writes.reserve(capacity.stagingBytes);
  let drawn: number,
    regionsMs = 0,
    passesMs = 0;
  try {
    drawn = forEachShadowBatch(
      rt,
      (from, to, runBase) => {
        if (from) writes.stage(encoder);
        const regionsStart = performance.now(),
          regions = writeShadowPages(lights, eye, from, to),
          passesStart = performance.now();
        regionsMs += passesStart - regionsStart;
        const encoded = encodeShadowAtlas(rt, device, encoder, regions, from, to, runBase);
        passesMs += performance.now() - passesStart;
        if (!encoded) return false;
        lights.shadowFaces += lights.runs.count;
        lights.shadowWork.drewBatch(pageModes, to - from);
        plan.commit(pageModes, from, to);
        return true;
      },
      capacity,
    );
  } finally {
    writes.end();
    encodeShadowRequests(rt, encoder);
  }
  recordShadowEncoding(rt.timing.cpuProfile.row, performance.now() - started, regionsMs, passesMs);
  lights.shadowPages = drawn;
  if (drawn < count) plan.reissue(drawn);
  return drawn === count;
}

/** Closes the frame's shadow work: what its batches drew joins the total a host reads across frames
 *  and drains; a batch that could not be encoded is not counted (`encodeShadowBatches`). */
export function noteShadowFrame(lights: WebgpuLightState) {
  lights.shadowPagesTotal += lights.shadowPages;
}
