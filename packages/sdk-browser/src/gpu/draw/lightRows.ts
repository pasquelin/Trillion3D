import { preparedComputePipeline } from '../../lighting/deferred/fullscreen.ts';
import { COMPUTE } from '../core/computeBindings.ts';
import { oncePerDevice } from '../core/oncePerDevice.ts';
import { ROW_MAP_SHADER } from './lightRowsWgsl.ts';
import { WORKGROUP } from './contract.ts';

/** The map's kernel, once a device: compiled off the thread at prepare for a scene that casts
 *  shadows (`../../webgpu/pages/prepare/lights.ts`), never at the first light cut. */
export const lightRowMapPipeline = oncePerDevice((device) => {
  const module = device.createShaderModule({ code: ROW_MAP_SHADER });
  const kinds = [
    { type: 'read-only-storage' } as const,
    { type: 'uniform' } as const,
    { type: 'storage' } as const,
  ];
  const bindLayout = device.createBindGroupLayout({
    entries: kinds.map((buffer, binding) => ({ binding, visibility: COMPUTE, buffer })),
  });
  const pipeline = preparedComputePipeline(device, {
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
    compute: { module, entryPoint: 'mapRows' },
  });
  return { bindLayout, pipeline };
});

/**
 * The map for a catalogue of `pages` pages. Every buffer is pushed onto `owned`, released with the
 * draw that created it.
 */
export function createLightRowMap(
  device: GPUDevice,
  itemsBuf: GPUBuffer,
  pages: number,
  owned: GPUBuffer[],
) {
  const make = (size: number, usage: number) => {
    const buffer = device.createBuffer({ size: Math.max(16, size), usage });
    owned.push(buffer);
    return buffer;
  };
  // Also written from the host: a blended cluster's row is pinned there (`pin`).
  const rowOf = make(pages * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
  const pinned = new Uint32Array(1);
  const uniforms = make(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const { bindLayout, pipeline: mapRows } = lightRowMapPipeline(device);
  const bindGroup = device.createBindGroup({
    layout: bindLayout,
    entries: [itemsBuf, uniforms, rowOf].map((buffer, binding) => ({
      binding,
      resource: { buffer },
    })),
  });
  const range = new Uint32Array(4);
  // Every row the map may name is unwritten: the first light run maps them all.
  let pendingFrom = 0,
    pendingTo = Number.MAX_SAFE_INTEGER;
  return {
    /** One word per catalogue page: the row that last carried it. */
    rowOf,
    /**
     * Page `page` casts from row `row`, which no draw record names: a blended cluster's caster row
     * (`../../webgpu/row/blendCasters.ts`). The map rows above never name such a page, so the word
     * stays until the next pin.
     */
    pin(page: number, row: number) {
      pinned[0] = row;
      device.queue.writeBuffer(rowOf, page * 4, pinned);
    },
    /** Rows `[from, to]` were just uploaded: the next light run maps them. */
    markRows(from: number, to: number) {
      if (to < from) return;
      pendingFrom = Math.min(pendingFrom, from);
      pendingTo = Math.max(pendingTo, to);
    },
    /**
     * Maps the rows rewritten since the last run, among the table's first `rows`, as the first
     * dispatch of `pass` — the pass that reads the map next. Nothing rewritten, nothing
     * dispatched; the caller sets its own pipeline and group after.
     */
    encode(pass: GPUComputePassEncoder, rows: number) {
      if (pendingTo < pendingFrom || rows <= pendingFrom) return;
      range[0] = pendingFrom;
      range[1] = Math.min(pendingTo, rows - 1);
      device.queue.writeBuffer(uniforms, 0, range);
      pass.setPipeline(mapRows.get());
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil((range[1] - range[0] + 1) / WORKGROUP));
      pendingFrom = Number.MAX_SAFE_INTEGER;
      pendingTo = -1;
    },
  };
}

export type LightRowMap = ReturnType<typeof createLightRowMap>;
