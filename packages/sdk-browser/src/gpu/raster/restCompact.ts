import { REST_COMPACT_SHADER, REST_COMPACT_WORKGROUP } from './restCompactWgsl.ts';
import { MAX_DRAW_SLOTS } from '../draw/draw.ts';
import { openValidation, validationError } from '../core/errorScope.ts';
import { cleanupFailedHiz } from '../hiz/pipelines.ts';
import { bounceGroup, bounceLayout } from '../../bounce/bindings.ts';
import { shaderFailed } from '../core/shaderModule.ts';

/** Pass label, the one the per-step profile files under "Geometry". */
export const REST_COMPACT_PASS = 'Trillion3D rest truncation';
const REST_PASS = { label: REST_COMPACT_PASS } as const;

export type GpuRestCompact = {
  /**
   * Brings each tested-half indirect command's instance count back to the rank of its last
   * surviving row. `rows` bounds the dispatch — a tested half cannot hold more rows than the
   * table has drawable. The row table is passed every frame: it is allocated after this kernel
   * is created.
   */
  encode(encoder: GPUCommandEncoder, restSlots: number, rows: number, pages: GPUBuffer): void;
  dispose(): void;
};

/**
 * Truncation of the tested half. It exists only if the draw compact and the pyramid exist:
 * without them there is neither an instance list nor a verdict to read. A platform without
 * compute returns `undefined`, and the frame keeps the previous path — the second pass then
 * draws the rejected rows, each vertex discarded one by one, exactly as before.
 */
export async function createGpuRestCompact(
  device: GPUDevice,
  buffers: {
    instances: GPUBuffer;
    indirect: GPUBuffer;
    slotOffsets: GPUBuffer;
    flags: GPUBuffer;
  },
): Promise<GpuRestCompact | undefined> {
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
    // Indexed by the tested slot's rank: half of the draw slots.
    const last = device.createBuffer({
      label: 'Trillion3D rest last survivor',
      size: (MAX_DRAW_SLOTS / 2) * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    owned = [uniforms, last];
    openValidation(device);
    const layout = bounceLayout(device, [
      'read-only-storage',
      'storage',
      'read-only-storage',
      'read-only-storage',
      'read-only-storage',
      'storage',
      'uniform',
    ]);
    const module = device.createShaderModule({ code: REST_COMPACT_SHADER });
    if (await shaderFailed(device, module)) return bail();
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const markPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'restMark' },
    });
    const applyPipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module, entryPoint: 'restApply' },
    });
    if (await validationError(device)) return bail();
    const uniData = new Uint32Array(4);
    let disposed = false,
      boundPages: GPUBuffer | undefined,
      boundSlots = 0,
      bindGroup!: GPUBindGroup;
    return {
      encode(encoder, restSlots, rows, pages) {
        if (disposed || restSlots < 1 || rows < 1) return;
        if (boundPages !== pages) {
          boundPages = pages;
          bindGroup = bounceGroup(device, layout, [
            buffers.instances,
            buffers.indirect,
            buffers.slotOffsets,
            pages,
            buffers.flags,
            last,
            uniforms,
          ]);
        }
        // The tested-slot count is fixed by preparation: the uniform is written only when it
        // changes.
        if (boundSlots !== restSlots) {
          boundSlots = restSlots;
          uniData[0] = restSlots;
          device.queue.writeBuffer(uniforms, 0, uniData);
        }
        // No frame reads a previous frame's rank: it starts from zero before the mark.
        encoder.clearBuffer(last, 0, restSlots * 4);
        const pass = encoder.beginComputePass(REST_PASS);
        pass.setBindGroup(0, bindGroup);
        pass.setPipeline(markPipeline);
        pass.dispatchWorkgroups(Math.ceil(rows / REST_COMPACT_WORKGROUP), restSlots);
        pass.setPipeline(applyPipeline);
        pass.dispatchWorkgroups(1);
        pass.end();
      },
      dispose() {
        disposed = true;
        for (const buffer of owned) buffer.destroy();
      },
    };
  } catch {
    await cleanupFailedHiz(device, owned);
    return undefined;
  }
}
