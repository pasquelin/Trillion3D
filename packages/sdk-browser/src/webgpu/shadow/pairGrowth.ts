import { KEPT_ROW_BYTES as ROW_BYTES } from '../../gpu/shadow/keptList.ts';
import { deviceMade } from '../../gpu/core/errorScope.ts';
import { pendingAll } from '../../gpu/core/tableGrowth.ts';
import { shadowTransmittanceBytes } from '../../gpu/shadow/transmittance.ts';
import { SHADOW_GRANT_BYTES } from '../../residency/shadowBudgetBytes.ts';
import {
  admitShadowBytes,
  grantsShadowLayer,
  noteShadowPressure,
  shadowPoolHeld,
} from './memoryGrant.ts';
import { transmittanceSettled } from './transmittanceGrant.ts';
import { queueTableGrowth } from '../pages/prepare/growthQueue.ts';
import { keptRows, poolPairs } from './pairRows.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/** The rows each region cull asked and the device has not answered yet: asked once, not each
 *  frame until it is in place. */
const asking = new WeakMap<object, number>();
const PAST_GRANT = 'The shadow pair list is past the grant';

/** Bytes of `rows` rows of the kept lists: the cull's, the occlusion test's that follows it, and
 *  the raster bins' — a row and, stored, its matrix (`../../gpu/shadow/bins.ts`). */
const listBytes = (rows: number, { occlusion, bins }: WebgpuPagesRuntime['lights']) =>
  rows * ROW_BYTES * (1 + (occlusion ? 1 : 0) + (bins?.stride ?? 0));

/** The bytes the kept lists — the cull's, the occlusion test's, the bins' alike — hold past the table's caster
 *  rows, the pairs' share the shadow grant holds (`shadowPoolHeld`): recounted after each growth. */
export function followPairBytes(rt: WebgpuPagesRuntime) {
  const { cull } = rt.lights,
    rows = cull ? Math.max(0, cull.capacity - rt.layout.rows.casterSlots) : 0;
  rt.lights.memory.pairBytes = listBytes(rows, rt.lights);
}

/**
 * THE KEPT LIST HOLDS THE GPU PAGES' PAIRS (#1363), at a size fixed by the pool (`poolPairs`,
 * #831): the pool's bytes the frame shows are the ones it was set to, whatever the frames count.
 * The pairs land in the region cull's kept list (`cull.kept`), free once the host's
 * batches are encoded. Short of that size, it grows once by the tables' own path
 * (`growKeptList`, `pendingBuffers`), the occlusion test's list with it, queued behind the tables'
 * growths (`queueTableGrowth`), asked once until answered: asked of the shadow grant beside what
 * the pool holds (`grantsShadowLayer`), then of the device under an out-of-memory scope, put in place between two
 * images once granted. Past the grant (`pairs-over-grant`, under `shadow-memory`) or refused
 * (`pairs-refused`, under `gpu-out-of-memory`, never asked again), the list stays: the pair cull
 * admits the longest prefix of whole regions it holds, the others wait for the host.
 */
export function growPairList(rt: WebgpuPagesRuntime) {
  const { lights, layout, gpu, diag, run } = rt,
    { cull, memory } = lights,
    device = gpu.device,
    need = poolPairs(lights.plan.pool.pages);
  if (!cull || !device || memory.events.includes('pairs-refused')) return;
  const rows = keptRows(layout.rows.casterSlots, need, device.limits),
    bytes = listBytes(rows - cull.capacity, lights);
  if (bytes <= 0 || rows <= (asking.get(cull) ?? 0)) return;
  // The transmittance layer still to come keeps its share, as the static layer leaves it
  // (`staticLayerGranted`): a grown list never takes the blended casters' shadows.
  const { side, layers } = lights.plan.pool,
    reserve = transmittanceSettled(lights) ? 0 : shadowTransmittanceBytes(side, layers);
  // Past the grant, said once: a later frame asks again, silently, what the grant may hold by then.
  const admitted = memory.events.includes('pairs-over-grant')
    ? admitShadowBytes(memory, shadowPoolHeld(lights), bytes, SHADOW_GRANT_BYTES, reserve)
    : grantsShadowLayer(
        lights,
        diag.engineDiagnostic,
        'pairs-over-grant',
        PAST_GRANT,
        bytes,
        SHADOW_GRANT_BYTES,
        reserve,
      );
  if (!admitted) return;
  asking.set(cull, rows);
  const { occlusion, bins } = lights,
    stale = () =>
      run.lost ||
      rt.signal.aborted ||
      lights.cull !== cull ||
      lights.occlusion !== occlusion ||
      lights.bins !== bins;
  const grow = async () => {
    if (stale() || rows <= cull.capacity) return;
    let made = pendingAll([]);
    const granted = await deviceMade(
      device,
      () => (made = pendingAll([cull.grow(rows), occlusion?.grow(rows), bins?.grow(rows)])),
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
    if (stale()) return granted.destroy();
    granted.commit();
    followPairBytes(rt);
    run.gate.resourcesChanged();
  };
  void queueTableGrowth(rt, () => grow().finally(() => asking.delete(cull)));
}
