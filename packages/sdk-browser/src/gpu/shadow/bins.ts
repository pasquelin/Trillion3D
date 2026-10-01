import { createCheckedShaderModule } from '../core/shaderModule.ts';
import { buildComputePipeline } from '../../lighting/deferred/fullscreen.ts';
import { PAGE_BIND_ALIGN } from '../draw/contract.ts';
import { pendingBuffers } from '../core/tableGrowth.ts';
import { MAX_SHADOW_REGIONS } from './recordPack.ts';
import { shadowBatchWrites } from './batchWrites.ts';
import { KEPT_ROW_BYTES, keptList } from './keptList.ts';
import { storageBufferCap } from '../../residency/pools.ts';
import { BIN_RUNS, BIN_UNIFORM_WORDS } from './batchBudget.ts';
import { BIN_STORED_STRIDE, SHADOW_BIN_REGION_BYTES, shadowBinShader } from './binShader.ts';

/** The bin pass's bindings, in `binShader.ts`'s order. */
const BINDINGS: readonly GPUBufferBindingType[] = [
  'uniform',
  'read-only-storage',
  'read-only-storage',
  'read-only-storage',
  'storage',
  'storage',
  'read-only-storage',
  'read-only-storage',
];

/** What one bin run reads: a region list and its commands, the cull's or the occlusion test's
 *  (`KEPT_LISTS_WGSL`), the rows' mobility words, and — for the stored LocalToClip — the page table
 *  and the regions' faces. */
export interface ShadowBinSource {
  list: GPUBuffer;
  counts: GPUBuffer;
  mobility: GPUBuffer;
  pages: GPUBuffer;
  views: GPUBuffer;
}

/**
 * THE RASTER BINS OF THE POOL'S REGIONS (OMB-26, #966, `binShader.ts`): one list as long as the
 * cull's — its rows, then, with `stored` (the `shadowLocalToClip` option, OMB-25), each place's
 * LocalToClip — and `SHADOW_BIN_COMMANDS` indirect commands a region, which every region draw reads
 * in place of the cull's or the occlusion test's (`../../webgpu/pages/render/encodeRegionDraws.ts`).
 * A command's first instance is its class's first place: made on a device that grants
 * `indirect-first-instance` alone, a device without it drawing the lists as they are. Grown with
 * the cull's list (`grow`); a frame allocates nothing. The matrices are kept while the list fits
 * one storage binding: past it, the list holds the rows alone, drawn by the default entries.
 */
export async function createShadowBins(device: GPUDevice, capacity: number, asked: boolean) {
  const label = 'Trillion3D shadow binned clusters v1',
    fits = (rows: number) =>
      rows * BIN_STORED_STRIDE * KEPT_ROW_BYTES <= storageBufferCap(device.limits);
  let stored = asked && fits(capacity),
    list = keptList(device, capacity * (stored ? BIN_STORED_STRIDE : 1), label);
  const commands = device.createBuffer({
    label: 'Trillion3D shadow bin commands v1',
    size: MAX_SHADOW_REGIONS * SHADOW_BIN_REGION_BYTES,
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE,
  });
  const uniform = device.createBuffer({
    size: BIN_RUNS * PAGE_BIND_ALIGN,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const release = () => [list, commands, uniform].forEach((buffer) => buffer.destroy());
  try {
    const layout = device.createBindGroupLayout({
      entries: BINDINGS.map((type, binding) => ({
        binding,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type, hasDynamicOffset: type === 'uniform' },
      })),
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const pipelines = await Promise.all(
      [false, ...(stored ? [true] : [])].map(async (store) => {
        const module = await createCheckedShaderModule(
          device,
          shadowBinShader(store),
          'SHADOW_BIN',
        );
        return buildComputePipeline(device, {
          layout: pipelineLayout,
          compute: { module, entryPoint: 'shadowBin' },
        });
      }),
    );
    const words = new Uint32Array(BIN_UNIFORM_WORDS);
    const groups: Array<{ group: GPUBindGroup; bound: GPUBuffer[] } | undefined> = [];
    const groupOf = (run: number, from: ShadowBinSource) => {
      const bound = [from.list, from.counts, from.mobility, list, commands, from.pages, from.views];
      const held = groups[run];
      if (held && held.bound.every((buffer, i) => buffer === bound[i])) return held.group;
      const group = device.createBindGroup({
        layout,
        entries: [uniform, ...bound].map((buffer, binding) => ({
          binding,
          resource: binding ? { buffer } : { buffer, size: BIN_UNIFORM_WORDS * 4 },
        })),
      });
      groups[run] = { group, bound };
      return group;
    };
    return {
      /** True while the list stores each place's LocalToClip (OMB-25). */
      get stored() {
        return stored;
      },
      /** Words a place takes: its row, and its stored matrix. */
      get stride() {
        return stored ? BIN_STORED_STRIDE : 1;
      },
      get list() {
        return list;
      },
      commands,
      /**
       * Bins the regions `binned` names among the batch's `regions`, from `from`: run 0 the cull's
       * lists, run 1 the occlusion test's, each at its own uniform slot — both written before the
       * batch's commands run (`batchWrites.ts`).
       */
      encode(
        encoder: GPUCommandEncoder,
        run: number,
        from: ShadowBinSource,
        regions: number,
        rows: number,
        binned: (region: number) => boolean,
      ) {
        words.fill(0);
        words[0] = regions;
        words[1] = rows;
        for (let region = 0; region < regions; region++)
          if (binned(region)) words[2 + (region >> 5)] |= 1 << (region & 31);
        shadowBatchWrites(device).write(uniform, run * PAGE_BIND_ALIGN, words);
        const pass = encoder.beginComputePass({ label: 'Trillion3D shadow bins' });
        pass.setPipeline(pipelines[+stored]);
        pass.setBindGroup(0, groupOf(run, from), [run * PAGE_BIND_ALIGN]);
        pass.dispatchWorkgroups(regions);
        pass.end();
      },
      /** The list at `rows` rows a region, the cull's (`keptList.ts`), put in place by `commit`:
       *  without its matrices from the size one binding no longer holds them. */
      grow(rows: number) {
        const keep = stored && fits(rows),
          next = keptList(device, rows * (keep ? BIN_STORED_STRIDE : 1), label);
        return pendingBuffers([next], () => {
          const old = list;
          list = next;
          stored = keep;
          return [old];
        });
      },
      dispose: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

export type ShadowBins = Awaited<ReturnType<typeof createShadowBins>>;
