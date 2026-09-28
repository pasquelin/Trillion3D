import type { PackedDag } from './types.ts';
import { primitiveFrameWords } from './worlds.ts';
import { createCameraFrames } from './frameRanges.ts';
import { createDagPipeline } from './pipeline.ts';
import { DAG_UNIFORM_BYTES, DAG_VIEW_WORDS } from './shader/viewsWgsl.ts';
import { AHEAD_VIEW } from './shader/aheadWgsl.ts';
import { cameraCutBuffers, makeDagBuffer, type DagBufferRow } from './bufferTable.ts';
import { ELEMENT_BYTES, type DagParts } from './split.ts';
import { createDagList, initialListCap } from './listCap.ts';

export async function createDagResources(
  device: GPUDevice,
  packed: PackedDag,
  residentCut: boolean,
  repeat: 'tout' | 'tete' | null = null,
  listCap = initialListCap(device.limits, packed.pageCount),
) {
  const pageCount = packed.pageCount,
    nodeCount = packed.nodeCount,
    worldCount = Math.max(1, packed.worldCount);
  // The compacted drawable-page list extends the snapshot: a header, then the ranks. One
  // contiguous copy reports both. Each is bounded by the CEILING and not by the catalogue: that
  // is what the frame copies and maps, and the worst case never happens (`layout.ts`,
  // measured by `tests/browser/probes/cut-snapshot-gpu.ts`); a cut that keeps more grows it
  // (`listCap.ts`).
  // The buffers, the kernel's block count and the layout of `work`, one table with the device
  // check (`bufferTable.ts`): two counters live behind the blocks in `work`, and only the byte
  // offsets a copy to the dispatch argument asks for are taken here.
  const { blockCount, travail, rows, parts, split } = cameraCutBuffers(packed, device.limits),
    liveGroupsOffset = travail.liveGroups * 4,
    candGroupsOffset = travail.candGroups * 4,
    drawnGroupsOffset = travail.drawnGroups * 4;
  // The camera's block, then the view ahead's (`shader/aheadWgsl.ts`).
  const uniformData = new Float32Array((AHEAD_VIEW + 1) * DAG_VIEW_WORDS);
  const frameData = primitiveFrameWords(packed);
  const buffers: GPUBuffer[] = [];
  /** A buffer of this cut's, or of its light cut's: the runtime's dispose destroys them all. */
  const own = (descriptor: GPUBufferDescriptor) => {
    const buffer = device.createBuffer(descriptor);
    buffers.push(buffer);
    return buffer;
  };
  try {
    /** A table's buffers, one per part (`split.ts`): the first at the table's own binding. */
    const make = (list: DagBufferRow[]) => list.map((row) => makeDagBuffer(own, row));
    const tables = { clusters: make(parts.clusters), nodes: make(parts.nodes) };
    const [clusters] = tables.clusters,
      [nodes] = tables.nodes;
    const uniforms = own({
      size: DAG_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Descent queue 0, then draw flags, then the cone word `dagWanted` keeps for `dagMask` (the
    // cone verdict and the cut rule's two comparisons), then the live-cluster list, then the
    // candidate list — which also serves as the previous frame's drawn journal —, then the
    // remaining queues, then each page's last use (`shader/lastUseWgsl.ts`): never read by the
    // CPU, which still only copies draw flags. Split, each part holds whole sections: the draw
    // mask lies in one (`split.ts`).
    const flagParts = make(parts.flags),
      [flags] = flagParts;
    // Three argument words, of which the last is one once and for all: x and y are copied, once
    // per indirect dispatch (`shader/gridWgsl.ts`). Passes following each other, one buffer is
    // enough.
    const dispatchArgs = own({
      size: 16,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(dispatchArgs, 0, new Uint32Array([0, 1, 1, 0]));
    const list = createDagList(own, listCap, residentCut);
    // No extra storage buffer, a stage's ceiling is already reached; arming words go to the
    // dispatch argument, hence the copy source.
    const work = makeDagBuffer(own, rows.work);
    const coldParts = make(parts.pageCones),
      [pageCones] = coldParts;
    const frames = createCameraFrames(device, frameData, worldCount, own, packed.worlds);
    const group = {
      clusters,
      nodes,
      views: uniforms,
      flags,
      out: list.output,
      work,
      cold: pageCones,
      parts: {
        clusters: tables.clusters.slice(1),
        nodes: tables.nodes.slice(1),
        cold: coldParts.slice(1),
        flags: flagParts.slice(1),
      },
    };
    const pipeline = await createDagPipeline(device, group, frames, split);
    if (!pipeline) {
      for (const buffer of buffers) buffer.destroy();
      return undefined;
    }
    /** Each part its own span of `source`, padded to its buffer's size. */
    const upload = (targets: GPUBuffer[], sizes: DagBufferRow[], source: Float32Array) => {
      const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      let from = 0;
      targets.forEach((target, k) => {
        const copy = new Uint8Array(sizes[k].size);
        copy.set(bytes.subarray(from, from + copy.byteLength));
        device.queue.writeBuffer(target, 0, copy);
        from += copy.byteLength;
      });
    };
    upload(tables.clusters, parts.clusters, packed.clusters);
    upload(tables.nodes, parts.nodes, packed.nodes);
    upload(coldParts, parts.pageCones, packed.pageCones);
    /** A table as its parts: what a host write spans (`writeParts`). */
    const partsOf = (buffers: GPUBuffer[], per: number, element: number): DagParts => ({
      buffers,
      bytes: buffers.length > 1 ? per * element : Number.MAX_SAFE_INTEGER,
    });
    return {
      device,
      packed,
      residentCut,
      repeat,
      pageCount,
      nodeCount,
      worldCount,
      blockCount,
      ...list,
      levelSizes: packed.levelSizes,
      liveGroupsOffset,
      candGroupsOffset,
      drawnGroupsOffset,
      uniformData,
      frameData,
      /** Writes into \`frames\`: a light cut copies its per-primitive words again when this moves. */
      frameWrites: { count: 0 },
      buffers,
      own,
      group,
      clusters,
      nodes,
      uniforms,
      flags,
      dispatchArgs,
      work,
      frames,
      pageCones,
      /** How the tables split on this device, and each as its parts (`split.ts`). */
      split,
      flagParts,
      nodeParts: partsOf(tables.nodes, split.nodes.per, ELEMENT_BYTES.nodes),
      coldParts: partsOf(coldParts, split.cold.per, ELEMENT_BYTES.cold),
      ...pipeline,
    };
  } catch {
    for (const buffer of buffers)
      try {
        buffer.destroy();
      } catch {
        /* Partial setup must not leak. */
      }
    return undefined;
  }
}
