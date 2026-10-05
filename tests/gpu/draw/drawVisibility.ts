// The visibility raster that consumes the GPU compaction, as the engine binds it
// (`visLayoutEntries`): a page table of one-triangle pages laid on a grid, each row written through
// the engine's row words, and one uniform block per indirect slot plus one for the direct path.
import { VIS_TRIANGLE_BITS } from '../../../packages/sdk-browser/src/visibility/visWords.ts';
import { PAGE_INFO_STRIDE } from '../../../packages/sdk-browser/src/visibility/buffer.ts';
import {
  ROW_HIZ_SLOT_WORD,
  ROW_ID_BASE_WORD,
  ROW_INDEX_WORDS,
  packedRowBase,
} from '../../../packages/sdk-browser/src/webgpu/row/pageRow.ts';
import { NO_HIZ_SLOT } from '../../../packages/sdk-browser/src/webgpu/row/noHizSlot.ts';
import {
  VIS_BINDINGS,
  VIS_UNIFORM_BYTES,
} from '../../../packages/sdk-browser/src/webgpu/core/bindLayout.ts';
import { visLayoutEntries } from '../../../packages/sdk-browser/src/webgpu/visibility/shaders.ts';

/** Pages in the table, laid `COLUMNS` × `ROWS` over a target of `WIDTH` × `HEIGHT`. */
const PAGES = 147,
  COLUMNS = 16,
  ROWS = 10;
export const WIDTH = 256,
  HEIGHT = 160;
/** A page drawn by the direct path, past the indirect slots, under its canonical instance index. */
export const DIRECT_PAGE = 122;
/** Words of `Uniforms` (`VIS_UNIFORMS_WGSL`) the slots differ by: the slot drawn, and whether its
 *  draw is indirect. */
const DRAW_SLOT_WORD = 20,
  INDIRECT_WORD = 21;

/** The page a visibility identifier names: its packed row base, less one (`packedRowBase`). */
export const pageOfId = (id: number) => (id >>> VIS_TRIANGLE_BITS) - 1;

/** The page table: each page's world matrix places its triangle in a grid cell, three indices,
 *  its identifiers' base, and no Hi-Z slot. */
function pageTable() {
  const words = PAGE_INFO_STRIDE / 4;
  const table = new Float32Array(PAGES * words),
    ints = new Uint32Array(table.buffer);
  for (let page = 0; page < PAGES; page++) {
    const base = page * words;
    const [x, y] = [
      (((page % COLUMNS) + 0.5) * 2) / COLUMNS - 1,
      1 - ((Math.floor(page / COLUMNS) + 0.5) * 2) / ROWS,
    ];
    table.set([0.8 / COLUMNS, 0, 0, 0, 0, 0.8 / ROWS, 0, 0, 0, 0, 1, 0, x, y, 0, 1], base);
    ints[base + ROW_INDEX_WORDS] = 3;
    ints[base + ROW_ID_BASE_WORD] = packedRowBase(page);
    ints[base + ROW_HIZ_SLOT_WORD] = NO_HIZ_SLOT;
  }
  return table;
}

/** The visibility pipelines (untested and tested halves), one bind group per slot and one for the
 *  direct page, and the layered target each slot draws into. */
export function setupVisibility(
  device: GPUDevice,
  module: GPUShaderModule,
  { instances, slotOffsets }: { instances: GPUBuffer; slotOffsets: GPUBuffer },
  slots: number,
) {
  const buffer = (size: number, usage: GPUBufferUsageFlags) => device.createBuffer({ size, usage });
  const upload = (data: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>) => {
    const made = buffer(data.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(made, 0, data);
    return made;
  };
  const table = upload(pageTable()),
    indices = upload(Uint32Array.of(0, 1, 2)),
    positions = upload(Float32Array.of(-1, -1, 0.5, 1, -1, 0.5, 0, 1, 0.5)),
    flags = upload(new Uint32Array(1)),
    uvs = upload(new Float32Array(6)),
    // No page carries a map: no lane pool is ever read, the atlas page table stays empty.
    colorPages = upload(new Uint32Array(64));
  const maps = device
    .createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING,
    })
    .createView({ dimension: '2d-array' });
  const sampler = device.createSampler();
  const layout = device.createBindGroupLayout({ entries: visLayoutEntries() });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const pipelines = ['vis_vs', 'vis_hiz_vs'].map((entryPoint) =>
    device.createRenderPipeline({
      layout: pipelineLayout,
      vertex: { module, entryPoint },
      fragment: { module, entryPoint: 'vis_fs', targets: [{ format: 'r32uint' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    }),
  );
  const b = VIS_BINDINGS;
  const groups = Array.from({ length: slots + 1 }, (_, slot) => {
    const block = new ArrayBuffer(VIS_UNIFORM_BYTES),
      ints = new Uint32Array(block);
    new Float32Array(block).set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    ints[DRAW_SLOT_WORD] = slot % slots;
    ints[INDIRECT_WORD] = slot < slots ? 1 : 0;
    const uniform = buffer(VIS_UNIFORM_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(uniform, 0, block);
    return device.createBindGroup({
      layout,
      entries: [
        { binding: b.cache, resource: { buffer: indices } },
        { binding: b.position, resource: { buffer: positions } },
        { binding: b.pageTable, resource: { buffer: table } },
        { binding: b.flags, resource: { buffer: flags } },
        { binding: b.uniform, resource: { buffer: uniform } },
        { binding: b.uv, resource: { buffer: uvs } },
        ...b.color.lanes.map((binding) => ({ binding, resource: maps })),
        { binding: b.color.pages, resource: { buffer: colorPages } },
        { binding: b.sampler, resource: sampler },
        { binding: b.instances, resource: { buffer: instances } },
        { binding: b.slotOffsets, resource: { buffer: slotOffsets } },
      ],
    });
  });
  const target = device.createTexture({
    size: [WIDTH, HEIGHT, slots + 1],
    format: 'r32uint',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const views = Array.from({ length: slots + 1 }, (_, slot) =>
    target.createView({ dimension: '2d', baseArrayLayer: slot, arrayLayerCount: 1 }),
  );
  return { pipelines, groups, target, views };
}
