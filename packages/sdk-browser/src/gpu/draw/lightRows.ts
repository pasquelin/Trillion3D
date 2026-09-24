import { COMPUTE } from '../core/computeBindings.ts';
import { DRAW_ITEM_WGSL, WORKGROUP } from './contract.ts';

/**
 * Catalogue page → page-table row, on the card beside the draw records: how the pages a light cut
 * drew find the rows that hold them (`../shadow/cullShader.ts`, `SHADOW_LIGHT_CULL_SHADER`).
 *
 * The map is kept by the rows the table rewrites and by them alone (`markRows`, over the range the
 * camera's encode uploaded), so a frame where no page arrives, leaves or moves touches none of it.
 * A stale entry is never trusted: the row it names must still carry that page, or the reader
 * drops it.
 */
const ROW_MAP_SHADER = `${DRAW_ITEM_WGSL}
struct Range{first:u32,last:u32,pad0:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read> items:array<DrawItem>;
@group(0) @binding(1) var<uniform> range:Range;
@group(0) @binding(2) var<storage, read_write> rowOf:array<u32>;
@compute @workgroup_size(${WORKGROUP})
fn mapRows(@builtin(global_invocation_id) id:vec3u){
 let row=range.first+id.x;
 if(row>range.last){return;}
 rowOf[items[row].selectionIndex]=row;
}
`;

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
  const rowOf = make(pages * 4, GPUBufferUsage.STORAGE);
  const uniforms = make(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const module = device.createShaderModule({ code: ROW_MAP_SHADER });
  const kinds = [
    { type: 'read-only-storage' } as const,
    { type: 'uniform' } as const,
    { type: 'storage' } as const,
  ];
  const bindLayout = device.createBindGroupLayout({
    entries: kinds.map((buffer, binding) => ({ binding, visibility: COMPUTE, buffer })),
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindLayout] }),
    compute: { module, entryPoint: 'mapRows' },
  });
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
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil((range[1] - range[0] + 1) / WORKGROUP));
      pendingFrom = Number.MAX_SAFE_INTEGER;
      pendingTo = -1;
    },
  };
}

export type LightRowMap = ReturnType<typeof createLightRowMap>;
