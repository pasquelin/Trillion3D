// The shadow scheduler with its pages mapped on the GPU (#1275), frame by frame, over a mock
// device: the engine's plan, the records it writes, the pages the shading reads marked in the
// request buffer as the demand marks them, the allocation and the table words run from their WGSL
// (`allocRun.fixture.ts`), the plan's draws, and the readback copied and read back as the engine
// copies it (`pageRequests.ts`). Where each report goes is the test's: delivered, or withheld.
import type { SceneLight, ShadowViewpoint } from '../../../../sdk-core/src/index.ts';
import { createSceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts';
import { createShadowPlan } from '../../../../sdk-core/src/scene/light-shadow/plan.ts';
import type { ShadowRequestReport } from '../../../../sdk-core/src/scene/light-shadow/requests.ts';
import { SHADOW_TABLE_ENTRIES } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts';
import { SHADOW_TABLE_OFFSET } from '../../gpu/shadow/atlas.ts';
import { createShadowRecordPack } from '../../gpu/shadow/recordPack.ts';
import { claimShadowRequest, runShadowAllocation, runShadowWords } from './allocRun.fixture.ts';
import { createShadowPageRequests } from './pageRequests.ts';
import { writeShadowRecords } from './pages.ts';
import { shadingReads, type Lit } from './shadingReads.fixture.ts';

/** The scene's box: a ground a hundred metres wide, ten metres deep. */
const MIN = [-50, 0, -50],
  MAX = [50, 10, 50];

/** A copy of `report`, whose slot the next copy reuses. */
const kept = (report: ShadowRequestReport): ShadowRequestReport => ({
  ...report,
  entries: report.entries.slice(),
  pool: report.pool && {
    ...report.pool,
    owner: report.pool.owner.slice(),
    requested: report.pool.requested.slice(),
  },
});

/**
 * `lights` over a pool of `poolSide`² pages whose pages the GPU maps. Each page's depth is noted
 * with the entry it was drawn for (`drawnFor`), as the plan draws it.
 */
export function gpuFrames(poolSide: number, lights: SceneLight[]) {
  installGpuGlobals();
  const { device } = mockGpu({ compute: true }) as unknown as { device: GPUDevice };
  const store = createSceneLightStore(),
    plan = createShadowPlan(poolSide),
    pack = createShadowRecordPack(256, poolSide);
  for (const light of lights) store.add(light);
  const requests = createShadowPageRequests(device, plan.pool.pages),
    allocation = requests.allocation,
    data = device.createBuffer({
      size: SHADOW_TABLE_OFFSET + SHADOW_TABLE_ENTRIES * 4,
      usage: GPUBufferUsage.STORAGE,
    });
  const bytes = (buffer: GPUBuffer) => (buffer as unknown as { data: Uint8Array }).data;
  const table = new Uint32Array(bytes(data).buffer, SHADOW_TABLE_OFFSET),
    owner = new Int32Array(bytes(allocation.state).buffer, 16, plan.pool.pages),
    drawnFor = new Int32Array(plan.pool.pages).fill(-1);
  const shadows = { writeSun: pack.writeSun, writeLamp: pack.writeLamp, clearRecord: pack.clear };
  return {
    plan,
    store,
    /** The GPU's page table, and the entry each GPU page maps. */
    table,
    owner,
    drawnFor,
    /**
     * Frame `frame` seen from `view`, lit at `lits`: the plan reads the reports handed to it, the
     * GPU maps what the shading reads, the plan draws, and the frame's report goes to `sent`.
     * Returns the entries the shading read.
     */
    async frame(
      frame: number,
      view: ShadowViewpoint,
      lits: Lit[],
      sent: (report: ShadowRequestReport) => void,
    ) {
      plan.plan(store, view, MIN, MAX, frame, frame * 16);
      writeShadowRecords({ store, plan, shadows } as never);
      bytes(data).set(new Uint8Array(pack.records.buffer));
      const read = shadingReads(plan, store, view, lits),
        list = bytes(requests.buffer);
      list.fill(0);
      for (const entry of read) claimShadowRequest(list, entry);
      if (!allocation.seeded) {
        allocation.seed(plan, data, SHADOW_TABLE_OFFSET);
        plan.gpu.set(true, frame);
      }
      allocation.writeParams(frame, plan.records.generation, plan.gpu.asks);
      const [state, keys, params] = [allocation.state, allocation.keys, allocation.params];
      runShadowAllocation(bytes(data), list, bytes(state), bytes(keys), bytes(params));
      for (const page of plan.admission.list.subarray(0, plan.admission.count))
        drawnFor[page] = plan.pool.owner[page];
      plan.commit();
      if (allocation.writeWords(plan, (sink) => plan.table.flush(sink)))
        runShadowWords(bytes(data), bytes(state), bytes(allocation.words));
      const encoder = device.createCommandEncoder(),
        stamp = plan.stamp(store);
      const deliver = (report: ShadowRequestReport) => sent(kept(report));
      const settle = requests.copy(encoder, frame, plan.table.layoutEpoch, stamp, deliver, true);
      settle?.(true);
      await requests.settled();
      return read;
    },
  };
}
