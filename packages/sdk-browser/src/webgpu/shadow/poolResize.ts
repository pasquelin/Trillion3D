import { deviceMade, grantPending, startGrant } from '../../gpu/core/errorScope.ts';
import { layerViews } from '../../gpu/shadow/layers.ts';
import { createShadowPageMover } from '../../gpu/shadow/pageMoves.ts';
import { shadowTransmittanceBytes } from '../../gpu/shadow/transmittance.ts';
import { shadowBufferBytes, type GpuShadowAtlas } from '../../gpu/shadow/atlas.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';
import { admitShadowBytes, noteShadowPressure, shadowPoolHeld } from './memoryGrant.ts';
import { disposeStaticLayer, type WebgpuLightState } from '../pages/state/lights.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { adoptShadowPool, askShadowPool } from './poolSize.ts';
import { followDemand } from '../../../../sdk-core/src/scene/light-shadow/poolDemand.ts';

/** The static layer let go, with its pyramids: no page keeps casters in it any more, and the next
 *  move of an object builds one for the pool in place (`encodeShadows.ts`). One still being made
 *  is let go where it lands; one refused stays refused. */
export function releaseStaticLayer(lights: WebgpuLightState) {
  lights.plan.pool.layered.fill(0);
  if (!lights.staticLayer) return;
  disposeStaticLayer(lights);
  lights.staticLayerPending = false;
}

/**
 * The first frame whose asks no page need of frame `frame` evicts (`allocWgsl.ts`): this one, or,
 * while the pool is held at its ceiling — the scene asks more than it can grow to — and the view
 * rests, the frame it came to rest. The jitter phases of a still view then never take each
 * other's pages: what they ask past the pool is refused and reads the coarser page, and the image
 * rests instead of drawing pages again every frame (#1345, PR #1359's first risk).
 */
export function shadowKeptFrom(lights: WebgpuLightState, frame: number) {
  const demand = lights.poolDemand;
  demand.restFrom = lights.plan.resting ? (demand.restFrom < 0 ? frame : demand.restFrom) : -1;
  return demand.ceiling && demand.restFrom >= 0 ? demand.restFrom : frame;
}

/**
 * THE SHADOW POOL FOLLOWS THE SCENE'S DEMAND. After each report, the pages it read at the drawn
 * size (`followDemand`): a demand past what the pool holds grows it, one that stays well under
 * shrinks it — from the same grant (`askShadowPool`), never from the screen's size. The frame is
 * held while the device answers (`deviceAnswering`): the previous image stays.
 *
 * Granted, the plan keeps every page the new pool holds (`resizeShadowPool`) and the GPU copies
 * each one, texel for texel, to its new place — its transmittance too when that layer is held,
 * made anew for the new pool (`pageMoves.ts`): no shadow is drawn again, none goes missing or
 * stale. The batch capacity and the request list follow the pool's pages (`shadowBatchCapacity`,
 * `createShadowPageRequests`). The static layer, as large as the pool, is let go first, making
 * room for the copy, and built again at the new size by the next move of an object.
 *
 * Refused — the pool at its floor, or the transmittance layer the new pool needs —, the pool in
 * place stays with every page it holds, said under `gpu-out-of-memory` (`grantedShadowPool`, and
 * here for the layer): shadows never go off for a resize. It is asked again at the next size the
 * demand asks. A capture resizes nothing.
 */
export function followShadowDemand(rt: WebgpuPagesRuntime) {
  const { lights, run, diag } = rt,
    atlas = lights.shadows,
    device = rt.gpu.device;
  if (!atlas?.texture || !device || grantPending(lights.shadowGrant) || rt.capture.capturing)
    return;
  const demand = lights.poolDemand,
    wanted = followDemand(lights.plan, demand);
  if (!demand.over) demand.ceiling = false;
  if (wanted === undefined) return;
  const ask = askShadowPool(rt, atlas, device, wanted),
    { pool } = lights.plan;
  // No light casts: nothing asked, and the next report is weighed once one does.
  if (!ask) return;
  const { side, layers } = ask.target,
    pages = side ** 2 * layers,
    held = pages === demand.asked || (side === pool.side && layers === pool.layers);
  // What the demand asks past the pool, it can no longer grow to: held at its ceiling.
  demand.ceiling = demand.over && held;
  if (held) return;
  demand.asked = pages;
  releaseStaticLayer(lights);
  const done = resizeTo(rt, atlas, device, ask).catch((error: unknown) => {
    if (!run.lost) diag.diagnosticFailure('shadow-pool-unavailable', error);
  });
  lights.shadowGrant = startGrant(done);
}

async function resizeTo(
  rt: WebgpuPagesRuntime,
  atlas: GpuShadowAtlas,
  device: GPUDevice,
  ask: NonNullable<ReturnType<typeof askShadowPool>>,
) {
  const { lights, run } = rt,
    kept = () => !run.lost && !rt.signal.aborted && lights.shadows === atlas;
  const mover = await createShadowPageMover(device),
    granted = await ask.grant();
  if (!granted) return;
  if (!kept()) return granted.made.destroy();
  const { side, layers } = granted.pool,
    pages = (shape: { side: number; layers: number }) => shape.side ** 2 * shape.layers;
  // Halved by the device's refusals below both the pool asked and the pool in place: the pool in
  // place stays, with every page it holds, rather than shrink for a refusal.
  if (pages(granted.pool) < Math.min(pages(ask.target), lights.plan.pool.pages))
    return granted.made.destroy();
  // The layer is asked of the shadows' grant beside the new pool, the old one being freed.
  if (atlas.transmittanceHeld && !layerFits(rt, atlas, granted.pool.allocatedBytes, side, layers))
    return granted.made.destroy();
  const layer = atlas.transmittanceHeld
    ? await deviceMade(device, () => atlas.makeTransmittance(layerViews(granted.made), side))
    : undefined;
  if (!kept() || (atlas.transmittanceHeld && !layer)) {
    granted.made.destroy();
    layer?.destroy();
    if (kept()) sayLayerRefused(rt, side, layers);
    return;
  }
  const from = lights.plan.pool.side,
    { moved, held } = adoptShadowPool(rt, atlas, device, granted, ask.wanted, layer);
  const before = held!,
    old = before.transmittance;
  mover.move(moved, [from, side], [before.texture, granted.made], layer && old && [old, layer]);
  before.texture.destroy();
  before.transmittance?.destroy();
  // A layer that landed while the device answered was made for the old pool.
  releaseStaticLayer(lights);
  lights.plannedFrame = lights.packedBatch.frame = -1;
  run.gate.resourcesChanged();
}

/** Whether the shadows' grant holds the new pool's transmittance layer beside that pool of
 *  `poolBytes`, once the old pool and its layer are freed; past it, said under `shadow-memory`
 *  (`transmittance-over-grant`) and the pool in place stays. */
function layerFits(
  rt: WebgpuPagesRuntime,
  atlas: GpuShadowAtlas,
  poolBytes: number,
  side: number,
  layers: number,
) {
  const { lights } = rt,
    buffers = shadowBufferBytes(lights.plan.table.entries),
    heldBytes = shadowPoolHeld(lights) - atlas.allocationBytes + buffers + poolBytes,
    requestedBytes = shadowTransmittanceBytes(side, layers);
  if (admitShadowBytes(lights.memory, heldBytes, requestedBytes)) return true;
  noteShadowPressure(lights.memory, 'transmittance-over-grant');
  rt.diag.engineDiagnostic(
    'shadow-memory',
    'The transmittance layer of the resized shadow pool is past the grant; the pool in place stays',
    {
      kind: 'warning',
      pressure: 'transmittance-over-grant',
      requestedBytes,
      heldBytes,
      grantBytes: SHADOW_GRANT_BYTES,
    },
  );
  return false;
}

/** The transmittance layer of the new pool refused: the resize is not taken, said by name. */
function sayLayerRefused(rt: WebgpuPagesRuntime, side: number, layers: number) {
  rt.diag.engineDiagnostic(
    'gpu-out-of-memory',
    'The device refused the shadow transmittance layer of the resized pool; the pool in place stays',
    {
      kind: 'warning',
      pool: 'shadow-transmittance',
      requestedBytes: shadowTransmittanceBytes(side, layers),
      grantedBytes: null,
    },
  );
}
