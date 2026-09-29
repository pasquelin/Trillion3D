import {
  PAGE_INFO_STRIDE,
  PAGE_DEFORM_WORD,
  PAGE_DEFORM_COUNT_WORD,
  PAGE_DEFORM_OUTPUT_WORD,
} from '../visibility/types.ts';
import type { BlendGpuItem } from '../webgpu/blend/state.ts';
import type { SessionDeformation } from './session.ts';
import { wholeDeformationInputs } from './wholeInputs.ts';
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';

/** High bit selects the existing float vertex pool instead of a resident page-cache tail. */
const WHOLE_DEFORM_OUTPUT = 0x80000000;

/** Setup-only layout of whole-copy source streams and per-placement results in the float pool. */
export function wholeDeformationPool(
  items: readonly BlendGpuItem[],
  session: SessionDeformation | undefined,
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
    floats += (item.sourceGeometry.attributes.position?.count ?? 0) * 11;
  }
  return {
    placed,
    floats,
    upload(
      device: GPUDevice,
      pool: GPUBuffer,
      base: number,
      vertexBase: (geometry: Geometry) => number,
    ) {
      for (const source of sources.values())
        device.queue.writeBuffer(pool, (base + source.at) * 4, source.data);
      const rows = new Uint32Array(Math.max(1, placed.length) * (PAGE_INFO_STRIDE / 4));
      placed.forEach((item, i) => {
        const at = i * (PAGE_INFO_STRIDE / 4);
        item.vertexBase = vertexBase(item.sourceGeometry);
        item.deformInput = base + sources.get(item.sourceGeometry)!.at + 1;
        item.deformOutput = ((base + output.get(item)! + 1) | WHOLE_DEFORM_OUTPUT) >>> 0;
        item.position = pool;
        item.deformBounds = new Float64Array([
          Infinity,
          Infinity,
          Infinity,
          -Infinity,
          -Infinity,
          -Infinity,
        ]);
        // Other attributes keep their shared geometry buffers; only position access has an offset.
        rows[at + 23] = item.flags;
        rows[at + 25] = item.count;
        rows[at + 26] = item.vertexBase;
        rows[at + 27] = item.deformInput;
        rows[at + PAGE_DEFORM_COUNT_WORD] = item.sourceGeometry.attributes.position!.count;
        rows[at + PAGE_DEFORM_WORD] = session!.wordOfWorld(item.matrix);
        rows[at + PAGE_DEFORM_OUTPUT_WORD] = item.deformOutput;
      });
      const table = device.createBuffer({
        label: 'Trillion3D whole-copy deformation rows',
        size: rows.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(table, 0, rows);
      return { table, count: placed.length };
    },
  };
}
