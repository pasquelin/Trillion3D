import { startGrant } from '../../../gpu/core/errorScope.ts';
import { viewGpu } from '../state/view.ts';
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

function refreshTargetFunding(rt: WebgpuPagesRuntime, size: FrameSize) {
  if (!rt.context.admitGpuMemory) return;
  const bytes = gpuDeviceLedgerOf(rt.gpu.device)?.snapshot().bytes;
  if (bytes === undefined || bytes === funded.get(rt)) return;
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
  const geometryMinimum = setup.geometryPoolFor(1).allocatedBytes + vertexBytesOf(gpu, vis);
  const textureMinimum =
    (setup.texturePools?.poolFor(1).allocatedBytes ?? 0) + (vis.textures?.sources.liveBytes ?? 0);
  const history =
    gpu.temporal && !rt.capture.capturing
      ? size.width * size.height * TAA_HISTORY_BYTES_PER_PIXEL
      : 0;
  const shadowPool =
    shadowPoolHeld(lights) + (gpu.device ? shadowBatchWrites(gpu.device).bytes : 0);
  const bounceProbes = bounce.probes ? 2 * bounce.probes.probes.size : 0;
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
    vertexBytesOf(gpu, vis) +
    (setup.texturePools?.pool.allocatedBytes ?? 0) +
    (vis.textures?.sources.liveBytes ?? 0);
  const additionalHeld = Math.max(0, (ledger?.bytes ?? separatelyHeld) - separatelyHeld);
  const pools = admit({
    frameTargets: current
      ? Math.max(0, (ledger?.bytes ?? separatelyHeld) - separatelyHeld + gpu.targetBytes)
      : bytes + history + additionalHeld,
    shadowPool,
    bounceProbes,
    effectTargets,
    geometryMinimum,
    textureMinimum,
  });
  // This call may run inside prepare itself: the host report's wait would await
  // this very target grant. Admission only redistributes the existing tables.
  const record = () => {
    funded.set(rt, gpuDeviceLedgerOf(gpu.device)?.snapshot().bytes ?? 0);
  };
  if (
    pools.geometryPoolBytes !== setup.geometryPool.budgetBytes ||
    pools.texturePoolBytes !== setup.texturePoolBudget
  )
    return setWebgpuMemoryBudgets(rt, pools, 'prepare-targets').then(record);
  record();
}

/** Hold only while an allocation change actually requires asynchronous pool redistribution. */
export function refreshTargetGrant(
  rt: WebgpuPagesRuntime,
  size: FrameSize,
  refuse: (error: unknown) => void,
) {
  if (rt.gpu.targetGrant) return rt.gpu.targetGrant.done;
  const refresh = refreshTargetFunding(rt, size);
  if (!refresh) return;
  const view = rt.views.active;
  const done = refresh.then(() => void (viewGpu(rt, view).targetGrant = undefined), refuse);
  rt.gpu.targetGrant = startGrant(done, { ...size });
  return done;
}
