import { grantPending, startGrant, type DeviceGrant } from '../../../gpu/core/errorScope.ts';
import { gpuDeviceLedgerOf } from '../../../gpu/core/deviceLedger.ts';
import { shadowPoolHeld } from '../../shadow/memoryGrant.ts';
import { shadowBatchWrites } from '../../../gpu/shadow/batchWrites.ts';
import { setWebgpuMemoryBudgets } from '../io/memory.ts';
import { vertexBytesOf } from '../io/metrics.ts';
import { TAA_HISTORY_BYTES_PER_PIXEL } from '../../../taa/temporalAntialiasing.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { FrameSize } from '../state/renderScale.ts';

/** Admit proposed targets before makeTargets creates any resource. Pool floors use
 * the same constructors as normal residency, so root coverage and texture tails
 * cannot be silently enlarged after this budget transaction. */
const funded = new WeakMap<WebgpuPagesRuntime, number>();
/** The pools funded again beside targets already in place, one at a time. */
const refreshing = new WeakMap<WebgpuPagesRuntime, DeviceGrant>();

function refreshTargetFunding(rt: WebgpuPagesRuntime, size: FrameSize) {
  if (!rt.context.admitGpuMemory) return;
  const bytes = gpuDeviceLedgerOf(rt.gpu.device)?.bytes;
  if (bytes === undefined || bytes === funded.get(rt)) return;
  // Asked once per ledger state, granted or refused: a refusal is said once, not every frame.
  funded.set(rt, bytes);
  try {
    return fundFrameTargets(rt, size, 0, true);
  } catch (error) {
    return Promise.reject(error);
  }
}

export function fundFrameTargets(
  rt: WebgpuPagesRuntime,
  size: FrameSize,
  bytes: number,
  current = false,
) {
  const admit = rt.context.admitGpuMemory;
  if (!admit) return;
  const { setup, gpu, vis, lights, bounce } = rt;
  const vertexBytes = vertexBytesOf(gpu, vis);
  const sourceBytes = vis.textures?.sources.liveBytes ?? 0;
  const geometryMinimum = setup.geometryPoolFor(1).allocatedBytes + vertexBytes;
  const textureMinimum = (setup.texturePools?.poolFor(1).allocatedBytes ?? 0) + sourceBytes;
  const history =
    gpu.temporal && !rt.capture.capturing
      ? size.width * size.height * TAA_HISTORY_BYTES_PER_PIXEL
      : 0;
  const shadowPool =
    shadowPoolHeld(lights) + (gpu.device ? shadowBatchWrites(gpu.device).bytes : 0);
  const bounceProbes = bounce.probes ? 2 * bounce.probes.probeBytes : 0;
  const effectTargets = gpu.effects?.bytes ?? 0;
  const ledger = gpuDeviceLedgerOf(gpu.device)?.snapshot();
  if (ledger?.unknownFormats) throw new Error('GPU_BUDGET_UNKNOWN_FORMAT');
  // Auxiliary buffers, other views/captures and proxy resources are already live.
  // Credit only the active view being replaced and the separately charged pools;
  // the device ledger is the existing ownership accounting, not a second budget.
  const separatelyHeld =
    gpu.targetBytes +
    shadowPool +
    bounceProbes +
    effectTargets +
    setup.geometryPool.allocatedBytes +
    vertexBytes +
    (setup.texturePools?.pool.allocatedBytes ?? 0) +
    sourceBytes;
  const unaccounted = (ledger?.bytes ?? separatelyHeld) - separatelyHeld;
  const pools = admit({
    frameTargets: current
      ? Math.max(0, unaccounted + gpu.targetBytes)
      : bytes + history + Math.max(0, unaccounted),
    shadowPool,
    bounceProbes,
    effectTargets,
    geometryMinimum,
    textureMinimum,
  });
  // This call may run inside prepare itself: the host report's wait would await
  // this very target grant. Admission only redistributes the existing tables.
  const record = () => {
    funded.set(rt, gpuDeviceLedgerOf(gpu.device)?.bytes ?? 0);
  };
  if (
    pools.geometryPoolBytes !== setup.geometryPool.budgetBytes ||
    pools.texturePoolBytes !== setup.texturePoolBudget
  )
    return setWebgpuMemoryBudgets(rt, pools, 'prepare-targets').then(record);
  record();
}

/** The pools' funding beside the frames still in flight, if any: no frame waits for it, but a
 *  target grant and a capture do, so two fundings never move the pools at once. */
export const poolFundingPending = (rt: WebgpuPagesRuntime) => grantPending(refreshing.get(rt));

/**
 * The targets in place fit: the pools are funded again beside the frames, never holding one —
 * like the reference's streaming pool, a budget moves quality, never presentation (#1362). A
 * refusal is said (`refuse`) and keeps the pools in place. Prepare and capture await the answer.
 */
export function refreshTargetGrant(
  rt: WebgpuPagesRuntime,
  size: FrameSize,
  refuse: (error: unknown) => void,
) {
  const pending = poolFundingPending(rt);
  if (pending) return pending;
  const refresh = refreshTargetFunding(rt, size);
  if (!refresh) return;
  const grant = startGrant(refresh.catch(refuse));
  refreshing.set(rt, grant);
  return grant.done;
}
