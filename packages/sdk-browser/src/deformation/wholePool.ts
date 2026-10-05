import {
  PAGE_INFO_STRIDE,
  PAGE_DEFORM_WORD,
  PAGE_DEFORM_COUNT_WORD,
  PAGE_DEFORM_OUTPUT_WORD,
} from '../visibility/types.ts';
import type { BlendGpuItem } from '../webgpu/blend/state.ts';
import type { SessionDeformation } from './session.ts';
import { wholeDeformationInputs } from './wholeInputs.ts';
import { DEFORM_VERTEX_WORDS, deformOutputWord } from './slotLayout.ts';
import { DEFORM_IN_POOL, FLAG_DYNAMIC } from '../visibility/types.ts';
import { DEFORMATION_LANES } from './computeWgsl.ts';
import type { GeometryBlock } from '../webgpu/row/pageRowMaterial.ts';
import type { DeformationOutput } from '../page/selection/types.ts';
import type { HostAttributes } from '../host/resources.ts';
import {
  ROW_FLAGS_WORD,
  ROW_ID_BASE_WORD,
  ROW_INDEX_WORDS,
  ROW_VERTEX_BASE_WORD,
} from '../webgpu/row/pageRow.ts';
import { boxEmpty } from '../../../sdk-core/src/index.ts';
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';

/**
 * Setup-only layout of whole-copy source streams and per-placement results in the float pool, and
 * of the float-pool blocks of the pages drawn from it (`pooled`, `../deformation/slotLayout.ts`):
 * rows of the table the stage dispatches after the page rows, one pass of its group each, which
 * deform every vertex of the geometry once for all the pages that read it. Such a row reads no
 * source header — its vertices are the pool's floats — and keeps the owner and image tags of a
 * slot's tail, so a dynamic geometry's last image is its previous one.
 */
export function wholeDeformationPool(
  items: readonly BlendGpuItem[],
  session: SessionDeformation | undefined,
  pooled: readonly DeformationOutput[] = [],
) {
  const placed = items.filter((item) => !item.paged && !!session?.wordOfWorld(item.matrix));
  const sources = new Map<Geometry, { data: Float32Array<ArrayBuffer>; at: number }>();
  let floats = 0;
  for (const item of placed) {
    const geometry = item.sourceGeometry;
    if (!sources.has(geometry)) {
      const data = wholeDeformationInputs(
        geometry,
        item.deformation?.softSourceIds,
        item.deformation?.softVertices,
      );
      sources.set(geometry, { data, at: floats });
      floats += data.length;
    }
  }
  const output = new Map<BlendGpuItem, number>();
  for (const item of placed) {
    output.set(item, floats + 2);
    floats += (item.sourceGeometry.attributes.position?.count ?? 0) * DEFORM_VERTEX_WORDS;
  }
  let rows = placed.length;
  const blocks = pooled.map((block) => {
    const at = floats + 2;
    floats += block.count * DEFORM_VERTEX_WORDS;
    rows += Math.ceil(block.count / DEFORMATION_LANES);
    return at;
  });
  return {
    placed,
    floats,
    /** Rows of the table: the whole copies, then the float-pool blocks' passes. */
    rows,
    upload(
      device: GPUDevice,
      pool: GPUBuffer,
      base: number,
      blockOf: (attributes: HostAttributes) => GeometryBlock,
    ) {
      for (const source of sources.values())
        device.queue.writeBuffer(pool, (base + source.at) * 4, source.data);
      const table = new Uint32Array(rows * (PAGE_INFO_STRIDE / 4));
      placed.forEach((item, i) => {
        const at = i * (PAGE_INFO_STRIDE / 4);
        item.vertexBase = blockOf(item.sourceGeometry.attributes).vertexBase;
        item.deformInput = base + sources.get(item.sourceGeometry)!.at + 1;
        item.deformOutput = ((base + output.get(item)! + 1) | DEFORM_IN_POOL) >>> 0;
        item.position = pool;
        item.deformBounds = new Float64Array(6);
        boxEmpty(item.deformBounds, 0);
        // Other attributes keep their shared geometry buffers; only position access has an offset.
        table[at + ROW_FLAGS_WORD] = item.flags;
        table[at + ROW_INDEX_WORDS] = item.count;
        table[at + ROW_VERTEX_BASE_WORD] = item.vertexBase;
        // A whole copy has no identifier base: its word carries the source streams' first float.
        table[at + ROW_ID_BASE_WORD] = item.deformInput;
        table[at + PAGE_DEFORM_COUNT_WORD] = item.sourceGeometry.attributes.position!.count;
        table[at + PAGE_DEFORM_WORD] = session!.wordOfWorld(item.matrix);
        table[at + PAGE_DEFORM_OUTPUT_WORD] = item.deformOutput;
      });
      let row = placed.length;
      pooled.forEach((block, i) => {
        const { attributes, world } = block.pool!,
          geometry = blockOf(attributes),
          deform = world ? (session?.wordOfWorld(world) ?? 0) : 0;
        block.from = base + blocks[i];
        const output = deformOutputWord(block, 0);
        // One pass of the stage's group a row, so the block's vertices spread over the device.
        for (let first = 0; first < block.count; first += DEFORMATION_LANES, row++) {
          const at = row * (PAGE_INFO_STRIDE / 4),
            count = Math.min(DEFORMATION_LANES, block.count - first);
          table[at + ROW_FLAGS_WORD] = geometry.dynamic ? FLAG_DYNAMIC : 0;
          table[at + ROW_INDEX_WORDS] = count; // any count but zero: the stage skips an empty row
          table[at + ROW_VERTEX_BASE_WORD] = geometry.vertexBase + first;
          table[at + PAGE_DEFORM_COUNT_WORD] = count;
          table[at + PAGE_DEFORM_WORD] = deform;
          table[at + PAGE_DEFORM_OUTPUT_WORD] = output + first * DEFORM_VERTEX_WORDS;
        }
      });
      const buffer = device.createBuffer({
        label: 'Trillion3D whole-copy deformation rows',
        size: table.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(buffer, 0, table);
      return { table: buffer, count: rows };
    },
  };
}
