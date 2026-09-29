import {
  BOUNCE_PROBES_PER_FRAME,
  BOUNCE_SETTINGS,
  bounceBatchOf,
  createBounceBudget,
  createBounceCascades,
  createBounceOccupancy,
  type SceneProxy,
} from '../../../sdk-core/src/index.ts';
import { bounceGroup, bounceLayout } from './bindings.ts';
import { bounceProbeBytes, ensureBounceFits } from './limits.ts';
import { BOUNCE_PROBE_PASS, BOUNCE_PROBE_SHADER } from './probeWgsl.ts';
import { createBounceSchedule } from './schedule.ts';
import { createBounceUniform } from './uniform.ts';
import { createGpuBounceProxy } from './proxy.ts';
import { createGpuBounceSurface, type GpuBounceSurface } from './surface.ts';
import { syncBounceProbes } from './probeSync.ts';
import { createCheckedShaderModule } from '../gpu/core/shaderModule.ts';

/** Proxy, lights, queue, frozen probes, output and canonical surface cache. */
const PROBE_TYPES: (GPUBufferBindingType | null)[] = [
  'uniform',
  'storage',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'read-only-storage',
];

export type GpuBounceProbes = Awaited<ReturnType<typeof createGpuBounceProbes>>;

/** Fixed-capacity cascades with bounded updates and session-owned moving geometry. */
export async function createGpuBounceProbes(
  device: GPUDevice,
  proxy: SceneProxy,
  /** The declared-light buffer, read at each encode: it is replaced when the scene outgrows it. */
  lights: () => GPUBuffer,
  budgetMs: number,
) {
  const cascades = createBounceCascades(proxy.bounds);
  const occupancy = createBounceOccupancy(proxy, cascades);
  const schedule = createBounceSchedule(cascades, occupancy);
  const budget = createBounceBudget(budgetMs);
  const probeBytes = bounceProbeBytes(cascades.reserveCount);
  ensureBounceFits(device, proxy, probeBytes, schedule.queue.byteLength);
  const resident = createGpuBounceProxy(device, proxy);
  const uniform = createBounceUniform(device, cascades);
  const queue = device.createBuffer({
    label: 'Trillion3D bounce probe queue v1',
    size: schedule.queue.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const probes = device.createBuffer({
    label: 'Trillion3D bounce probes v2',
    size: probeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const snapshot = device.createBuffer({
    label: 'Trillion3D bounce probes snapshot v2',
    size: probeBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const release = () => {
    queue.destroy();
    uniform.dispose();
    probes.destroy();
    snapshot.destroy();
    resident.dispose();
  };
  let surface!: GpuBounceSurface;
  let pipeline: GPUComputePipeline;
  let group: GPUBindGroup;
  let boundLights: GPUBuffer;
  let layout: GPUBindGroupLayout;
  /** The probe group, on the light buffer of the moment. */
  const bind = () =>
    bounceGroup(device, layout, [
      uniform.buffer,
      resident.buffer,
      (boundLights = lights()),
      queue,
      snapshot,
      probes,
      surface.buffer,
    ]);
  try {
    surface = await createGpuBounceSurface(device, resident, lights, {
      uniform: uniform.buffer,
      snapshot,
    });
    const module = await createCheckedShaderModule(device, BOUNCE_PROBE_SHADER, 'BOUNCE_PROBE');
    layout = bounceLayout(device, PROBE_TYPES);
    pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint: 'updateProbes' },
    });
    group = bind();
  } catch (error) {
    surface?.dispose();
    release();
    throw error;
  }
  let clearOwed = 0;
  let generation = 1,
    frame = 0,
    updates = 0;
  /** Posed hits read the surface cache, and its pass keeps owned triangles at their pose: the
   *  series closes when both sweeps have. */
  const rounds = () => Math.min(schedule.sweeps, surface.sweeps);
  /** True while the bounce series is not closed: beyond that, nothing more is encoded. */
  const working = () => rounds() < BOUNCE_SETTINGS.settledSweeps;
  const batch = () => bounceBatchOf(BOUNCE_PROBES_PER_FRAME, budget.load);
  const restart = () => {
    generation++;
    schedule.restart();
    surface.restart();
  };
  const invalidate = (levels: number) => void (clearOwed |= levels);
  const parts = { resident, cascades, occupancy, invalidate, restart };
  return {
    /** Moved, settled or nothing (`probeSync.ts`). */
    sync(worldOf: (source: number) => ArrayLike<number> | undefined) {
      return syncBounceProbes(parts, worldOf);
    },
    /** Owned leaves wait for their still streak to settle (`proxyMotion.ts`). */
    get settling() {
      return resident.settling;
    },
    cascades,
    occupancy,
    budget,
    surface,
    proxy: resident,
    uniform: uniform.buffer,
    probes,
    /** Frames of a full round, measured: that is the bound on convergence lag. */
    get sweepFrames() {
      return Math.max(schedule.sweepFrames, surface.sweepFrames, 1);
    },
    /** Probes the occupancy map keeps at the finest level, on its cells. */
    get activeProbes() {
      return occupancy.marked;
    },
    /** Probes updated by the last encoded frame, and rays they launched. */
    get lastProbes() {
      return updates;
    },
    get lastRays() {
      return updates * BOUNCE_SETTINGS.raysPerProbe;
    },
    /** True while the bounce series is not closed: beyond that, nothing more is encoded. */
    get working() {
      return working();
    },
    /** Stage timer, as the per-stage profile recorded it. `null` is not zero. */
    observeGpuMs(ms: number | null) {
      budget.observe(ms);
    },
    setIrradianceView: uniform.setIrradianceView,
    /** A light changed: sweeps restart, sleeping probes wake. */
    restart,
    /**
     * Encodes a cache round then a probe batch. Returns `false` when there was nothing to do:
     * the scene is still, the series is closed, and the « Bounce » stage is « unmeasured ».
     */
    encode(encoder: GPUCommandEncoder, lightsActive: number, viewpoint: ArrayLike<number>) {
      updates = 0;
      const levelBytes = bounceProbeBytes(cascades.probesPerLevel);
      for (let level = 0; level < BOUNCE_SETTINGS.cascadeLevels; level++)
        if (clearOwed & (1 << level)) encoder.clearBuffer(probes, level * levelBytes, levelBytes);
      clearOwed = 0;
      if (lights() !== boundLights) group = bind();
      occupancy.settle(resident.triangleBoxes, resident.bounds);
      if (cascades.follow(viewpoint)) schedule.restart();
      if (!cascades.probes || !lightsActive || !working()) return false;
      frame++;
      const groups = schedule.plan(batch());
      if (groups) device.queue.writeBuffer(queue, 0, schedule.queue, 0, groups);
      uniform.write(generation, groups, frame);
      encoder.copyBufferToBuffer(probes, 0, snapshot, 0, probeBytes);
      surface.encode(encoder, budget.load);
      if (groups) {
        const pass = encoder.beginComputePass({ label: BOUNCE_PROBE_PASS });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(groups, 1, 1);
        pass.end();
      }
      updates = groups;
      return true;
    },
    dispose() {
      surface.dispose();
      release();
    },
  };
}
