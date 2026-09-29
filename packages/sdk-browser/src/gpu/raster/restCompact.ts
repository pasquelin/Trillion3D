import { REST_COMPACT_SHADER, REST_COMPACT_WORKGROUP } from './restCompactWgsl.ts';
import { validated } from '../core/errorScope.ts';
import { cleanupFailedHiz } from '../hiz/pipelines.ts';
import { bounceGroup, bounceLayout } from '../../bounce/bindings.ts';
import { shaderFailed } from '../core/shaderModule.ts';
import { pendingBuffers, type PendingGrowth } from '../core/tableGrowth.ts';

/** Pass label, the one the per-step profile files under "Geometry". */
export const REST_COMPACT_PASS = 'Trillion3D rest compaction';
const REST_PASS = { label: REST_COMPACT_PASS } as const;

export type GpuRestCompact = {
  /**
   * Keeps, in each tested-half indirect command, only its surviving rows, in their order, and
   * counts them. `rows` bounds the dispatch — a tested half cannot hold more rows than the table
   * has drawable. The row table is passed every frame: it is allocated after this kernel is
   * created.
   */
  encode(encoder: GPUCommandEncoder, restSlots: number, rows: number, pages: GPUBuffer): void;
  /** Reads `buffers` from now on: those of a draw compact and a Hi-Z test grown in place. */
  rebind(buffers: RestCompactSources): void;
  /** The work buffer a table of `rows` rows, `copyWords` instance words and `restSlots` tested
   *  slots needs, made now and put in place by `commit`; nothing when the one held suffices. */
  growWork(copyWords: number, restSlots: number, rows: number): PendingGrowth | undefined;
  /** The work buffer held, once an image made it or a growth did. */
  readonly work: GPUBuffer | undefined;
  dispose(): void;
};

/** What the compaction reads and writes: the draw compact's lists and the Hi-Z verdicts. */
type RestCompactSources = {
  instances: GPUBuffer;
  indirect: GPUBuffer;
  slotOffsets: GPUBuffer;
  flags: GPUBuffer;
};

/**
 * Compaction of the tested half. It exists only if the draw compact and the pyramid exist:
 * without them there is neither an instance list nor a verdict to read. A platform without
 * compute returns `undefined`, and the frame keeps the previous path — the second pass then
 * draws the rejected rows, each vertex discarded one by one, exactly as before.
 */
export async function createGpuRestCompact(
  device: GPUDevice,
  sources: RestCompactSources,
): Promise<GpuRestCompact | undefined> {
  let buffers = sources;
  if (typeof device.createComputePipeline !== 'function') return undefined;
  let owned: GPUBuffer[] = [];
  const bail = () => {
    for (const buffer of owned) buffer.destroy();
    return undefined;
  };
  try {
    const uniforms = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    owned = [uniforms];
    const made = await validated(device, async () => {
      const layout = bounceLayout(device, [
        'storage',
        'storage',
        'read-only-storage',
        'read-only-storage',
        'read-only-storage',
        'storage',
        'uniform',
      ]);
      const module = device.createShaderModule({ code: REST_COMPACT_SHADER });
      if (await shaderFailed(module)) return undefined;
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const stage = (entryPoint: string) =>
        device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
      return {
        layout,
        countPipeline: stage('restCount'),
        scanPipeline: stage('restScan'),
        scatterPipeline: stage('restScatter'),
      };
    });
    if (!made) return bail();
    const { layout, countPipeline, scanPipeline, scatterPipeline } = made;
    // The copy covers the instance list's own range; the counts and tile words follow it.
    let copyWords = buffers.instances.size / 4;
    const uniData = new Uint32Array(4);
    let disposed = false,
      work: GPUBuffer | undefined,
      bound: { pages: GPUBuffer; work: GPUBuffer } | undefined,
      bindGroup!: GPUBindGroup;
    return {
      encode(encoder, restSlots, rows, pages) {
        if (disposed || restSlots < 1 || rows < 1) return;
        const tiles = Math.ceil(rows / REST_COMPACT_WORKGROUP);
        const words = workWords(copyWords, restSlots, rows);
        // The work buffer only grows: a frame with more rows or slots reallocates it once.
        if (!work || work.size < words * 4) {
          work?.destroy();
          work = workBuffer(device, words);
          owned = [uniforms, work];
        }
        if (bound?.pages !== pages || bound.work !== work) {
          bound = { pages, work };
          bindGroup = bounceGroup(device, layout, [
            buffers.instances,
            buffers.indirect,
            buffers.slotOffsets,
            pages,
            buffers.flags,
            work,
            uniforms,
          ]);
        }
        // Slots and tiles are fixed by preparation: the uniform is written only when they change.
        if (uniData[0] !== restSlots || uniData[1] !== tiles) {
          uniData.set([restSlots, tiles, copyWords, 0]);
          device.queue.writeBuffer(uniforms, 0, uniData);
        }
        const pass = encoder.beginComputePass(REST_PASS);
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(countPipeline);
        pass.dispatchWorkgroups(tiles, restSlots);
        pass.setPipeline(scanPipeline);
        pass.dispatchWorkgroups(1);
        pass.setPipeline(scatterPipeline);
        pass.dispatchWorkgroups(tiles, restSlots);
        pass.end();
      },
      get work() {
        return work;
      },
      growWork(nextWords, restSlots, rows) {
        const words = workWords(nextWords, restSlots, rows);
        if (work && work.size >= words * 4) return undefined;
        const next = workBuffer(device, words);
        return pendingBuffers([next], () => {
          const old = work;
          work = next;
          owned = [uniforms, next];
          return [old];
        });
      },
      rebind(next) {
        buffers = next;
        copyWords = next.instances.size / 4;
        // The group and the uniform are made again at the next encode.
        bound = undefined;
        uniData[0] = 0;
      },
      dispose() {
        disposed = true;
        for (const buffer of owned) buffer.destroy();
      },
    };
  } catch {
    cleanupFailedHiz(owned);
    return undefined;
  }
}

/** Words of the work buffer: the instance list's copy, then each tested slot's count and tiles. */
const workWords = (copyWords: number, restSlots: number, rows: number) =>
  copyWords + restSlots * (1 + Math.ceil(rows / REST_COMPACT_WORKGROUP));

const workBuffer = (device: GPUDevice, words: number) =>
  device.createBuffer({
    label: 'Trillion3D rest compaction work',
    size: words * 4,
    usage: GPUBufferUsage.STORAGE,
  });
