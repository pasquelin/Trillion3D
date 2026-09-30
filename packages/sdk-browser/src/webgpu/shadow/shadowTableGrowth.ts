import { deviceMade } from '../../gpu/core/errorScope.ts';
import { queueTableGrowth } from '../pages/prepare/growthQueue.ts';
import { noteShadowPressure } from './memoryGrant.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import type { WebgpuLightState } from '../pages/state/lights.ts';
import { castsShadow } from '../../../../sdk-core/src/scene/light-shadow/casters.ts';
import { shadowTableStride } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';

/** The words each atlas's table was asked to grow to and the device has not answered yet. */
const asking = new WeakMap<object, number>();

/**
 * THE GPU PAGE TABLE GROWN TO THE SLICES THE LIGHTS ASK (#1345). The host's table follows the GPU's
 * (`table.follow`), asked a span ahead of the slices claimed (`wantedEntries`): a light whose slice
 * reaches past the words held — added before the span ahead was granted — waits, unshadowed and
 * counted. The GPU's table grows by the tables' own path (`atlas.growTable`, `pendingBuffers`),
 * queued behind the tables' growths (`queueTableGrowth`), asked once until answered: under the
 * device's out-of-memory check, then put in place between two images, the host's words grown to as
 * many (`table.hold`). The grant already counts every slice's span (`SHADOW_BUFFER_BYTES`).
 * Refused (`table-refused`, under `gpu-out-of-memory`, never asked again), the table stays as is.
 */
export function growShadowTable(rt: WebgpuPagesRuntime) {
  const { lights, gpu, diag, run } = rt,
    { shadows, memory } = lights,
    { table } = lights.plan,
    device = gpu.device,
    wanted = table.wantedEntries;
  if (!shadows || !device || wanted <= shadows.tableEntries) return;
  if (memory.events.includes('table-refused') || wanted <= (asking.get(shadows) ?? 0)) return;
  asking.set(shadows, wanted);
  const stale = () => run.lost || rt.signal.aborted || lights.shadows !== shadows;
  const grow = async () => {
    // Grown meanwhile by an earlier ask: nothing more to make.
    if (stale() || wanted <= shadows.tableEntries) return;
    const made = await deviceMade(device, () => shadows.growTable(wanted)!);
    if (!made) {
      noteShadowPressure(memory, 'table-refused');
      diag.engineDiagnostic('gpu-out-of-memory', 'The device refused the grown shadow page table', {
        kind: 'warning',
        pool: 'shadow-table',
        requestedBytes: (wanted - shadows.tableEntries) * 4,
        grantedBytes: null,
      });
      return;
    }
    if (stale()) return made.destroy();
    made.commit();
    table.hold(shadows.tableEntries);
    run.gate.resourcesChanged();
  };
  void queueTableGrowth(rt, () => grow().finally(() => asking.delete(shadows)));
}

/** The GPU page table's words at prepare: a span for each shadow-casting light the scene holds and
 *  one more, so that none — nor the next one added — waits for the table; the host's at least. */
export function preparedShadowTable({ store, plan }: WebgpuLightState) {
  let casting = 0;
  for (let slot = 0; slot < store.count; slot++) if (castsShadow(store, slot)) casting++;
  const spans = (casting + 1) * shadowTableStride(plan.sunWindow);
  return Math.min(plan.table.entries, Math.max(plan.table.heldEntries, spans));
}

/** The host's table follows the GPU's `entries` words from now on (`growShadowTable`). */
export function followShadowTable({ plan }: WebgpuLightState, entries: number) {
  plan.table.hold(entries);
  plan.table.follow();
}
