// The shadow scheduler with its pages mapped on the GPU (#1275), frame by frame, over a mock
// device: the engine's plan, the records it writes, the pages the shading reads marked in the
// request buffer as the demand marks them, the allocation and the table words run from their WGSL
// (`allocRun.fixture.ts`), the plan's draws, then the pages the GPU draws itself composed from
// theirs (`freshRun.fixture.ts`), and the readback copied and read back as the engine copies it
// (`pageRequests.ts`). Where each report goes is the test's: delivered, or withheld.
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
import { runShadowFresh } from './freshRun.fixture.ts';
import { POOL_COUNTS, POOL_FIELDS } from './poolWgsl.ts';
import { freshSlices } from './freshPass.ts';
import { FRESH_ARG, FRESH_REGION_PAGES } from './freshLayout.ts';
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
 * `lights` over a pool of `poolSide`² pages whose pages the GPU maps, and draws too unless
 * `gpuDraws` is false. Each page's depth is noted with the entry it was drawn for (`drawnFor`), as
 * the plan and the GPU draw it.
 */
export function gpuFrames(poolSide: number, lights: SceneLight[], gpuDraws = true) {
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
  const pages = plan.pool.pages,
    table = new Uint32Array(bytes(data).buffer, SHADOW_TABLE_OFFSET),
    field = (name: (typeof POOL_FIELDS)[number]) =>
      new Int32Array(
        bytes(allocation.state).buffer,
        (POOL_COUNTS.length + POOL_FIELDS.indexOf(name) * pages) * 4,
        pages,
      ),
    owner = field('owner'),
    drawnFor = new Int32Array(pages).fill(-1),
    drawnAt = new Int32Array(pages).fill(-1),
    regions: number[] = [];
  const shadows = { writeSun: pack.writeSun, writeLamp: pack.writeLamp, clearRecord: pack.clear };
  return {
    plan,
    store,
    /** The GPU's page table, the entry each GPU page maps, and its other fields. */
    table,
    owner,
    field,
    drawnFor,
    /** The frame each page was last drawn in. */
    drawnAt,
    /** The views and volumes the GPU composed its pages into, and the page of each region the
     *  last frame. */
    views: bytes(allocation.freshFaces),
    volumes: bytes(allocation.freshVolumes),
    regions,
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
      const drawList = bytes(allocation.drawList);
      runShadowAllocation(bytes(data), list, bytes(state), bytes(keys), bytes(params), drawList);
      for (const page of plan.admission.list.subarray(0, plan.admission.count)) {
        drawnFor[page] = plan.pool.owner[page];
        drawnAt[page] = frame;
      }
      plan.commit();
      if (allocation.writeWords(plan, frame, (sink) => plan.table.flush(sink)))
        runShadowWords(bytes(data), bytes(state), bytes(allocation.words), drawList);
      regions.length = 0;
      if (gpuDraws) {
        // No caster row: the cull keeps no pair, and every region is sealed readable.
        allocation.writeFresh(poolSide, 1, 0, [0, 0], 0, freshSlices(store));
        const fresh = [data, state, allocation.drawList, allocation.freshFaces];
        fresh.push(allocation.freshVolumes, allocation.freshArgs, allocation.freshParams);
        for (const entry of ['composeShadowPages', 'sealShadowPages'])
          runShadowFresh(entry, ...fresh.map(bytes));
        const args = new Uint32Array(bytes(allocation.freshArgs).buffer);
        regions.push(
          ...args.subarray(FRESH_REGION_PAGES, FRESH_REGION_PAGES + args[FRESH_ARG.regions]),
        );
        for (const page of regions) {
          drawnFor[page] = owner[page];
          drawnAt[page] = frame;
        }
      }
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
