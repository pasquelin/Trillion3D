import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/recordPack.ts';
import { deviceMade } from '../../gpu/core/errorScope.ts';
import { pendingAll } from '../../gpu/core/tableGrowth.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/memoryBudget.ts';
import { storageBufferCap } from '../../residency/pools.ts';
import { admitShadowBytes, noteShadowPressure, shadowPoolHeld } from './memoryGrant.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** Bytes of a kept pair: its region, its row. */
export const PAIR_BYTES = 8;
/** Bytes of one row of every region of a kept list (`keptList.ts`). */
const ROW_BYTES = 4 * MAX_SHADOW_REGIONS;
/** Rows asked at once: a need growing pair by pair asks the device rarely. */
const ROW_STEP = 64;

/** Pairs a kept list of `rows` rows a region holds. */
export const keptPairs = (rows: number) => Math.floor((rows * ROW_BYTES) / PAIR_BYTES);

/** The rows a region of the kept list holds: the table's `casterSlots`, or more for the GPU pages'
 *  `need` pairs — by `ROW_STEP` —, never past what one storage binding holds. */
export function keptRows(casterSlots: number, need: number, limits?: GPUSupportedLimits) {
  const asked = ROW_STEP * Math.ceil((need * PAIR_BYTES) / (ROW_BYTES * ROW_STEP));
  return Math.max(casterSlots, Math.min(asked, Math.floor(storageBufferCap(limits) / ROW_BYTES)));
}

/** The bytes the kept lists — the cull's, the occlusion test's alike — hold past the table's caster
 *  rows, the pairs' share the shadow grant holds (`shadowPoolHeld`): recounted after each growth. */
export function followPairBytes(rt: WebgpuPagesRuntime) {
  const { cull, occlusion } = rt.lights,
    rows = cull ? Math.max(0, cull.capacity - rt.layout.rows.casterSlots) : 0;
  rt.lights.memory.pairBytes = rows * ROW_BYTES * (occlusion ? 2 : 1);
}

/**
 * THE KEPT LIST GROWN TO THE GPU PAGES' PAIRS (#1363). The pairs the latest frame read back
 * counted (`pairNeed`, the pool's `pairs` count) land in the region cull's kept list (`cull.kept`),
 * free once the host's batches are encoded. Past what it holds, it grows by the tables' own path
 * (`growKeptList`, `pendingBuffers`), the occlusion test's list with it, queued behind the tables'
 * growths (`growWebgpuTables`): asked of the shadow grant beside what the pool holds
 * (`admitShadowBytes`), then of the device under an out-of-memory scope, put in place between two
 * images once granted. Past the grant (`pairs-over-grant`, under `shadow-memory`) or refused
 * (`pairs-refused`, under `gpu-out-of-memory`, never asked again), the list stays: the pair cull
 * admits the longest prefix of whole regions it holds, the others wait for the host.
 */
export function growPairList(rt: WebgpuPagesRuntime) {
  const { lights, layout, gpu, diag, run } = rt,
    { cull, memory } = lights,
    device = gpu.device,
    need = lights.pageRequests?.allocation.pairNeed ?? 0;
  if (!cull || !device || memory.events.includes('pairs-refused')) return;
  const rows = keptRows(layout.rows.casterSlots, need, device.limits),
    bytes = (rows - cull.capacity) * ROW_BYTES * (lights.occlusion ? 2 : 1);
  if (bytes <= 0) return;
  const heldBytes = shadowPoolHeld(lights);
  if (!admitShadowBytes(memory, heldBytes, bytes)) {
    if (memory.events.includes('pairs-over-grant')) return;
    noteShadowPressure(memory, 'pairs-over-grant');
    diag.engineDiagnostic('shadow-memory', 'The shadow pair list is past the grant', {
      kind: 'warning',
      pressure: 'pairs-over-grant',
      requestedBytes: bytes,
      heldBytes,
      grantBytes: SHADOW_GRANT_BYTES,
    });
    return;
  }
  const grow = async () => {
    await rt.setup.preparing;
    const { occlusion } = lights;
    if (lights.cull !== cull || rows <= cull.capacity || run.lost || rt.signal.aborted) return;
    let made = pendingAll([]);
    const granted = await deviceMade(
      device,
      () => (made = pendingAll([cull.grow(rows), occlusion?.grow(rows)])),
    );
    if (!granted) {
      noteShadowPressure(memory, 'pairs-refused');
      diag.engineDiagnostic('gpu-out-of-memory', 'The device refused the grown shadow pair list', {
        kind: 'warning',
        pool: 'shadow-pairs',
        requestedBytes: made.bytes,
        grantedBytes: null,
      });
      return;
    }
    if (run.lost || rt.signal.aborted || lights.cull !== cull || lights.occlusion !== occlusion)
      return granted.destroy();
    granted.commit();
    followPairBytes(rt);
    run.gate.resourcesChanged();
  };
  layout.growing = (layout.growing ?? Promise.resolve()).then(grow, grow);
}
