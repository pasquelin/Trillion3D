import type { PackedDag } from './types.ts';
import { primitiveFrameWords } from './worlds.ts';
import { createCameraFrames } from './frameRanges.ts';
import { createDagPipeline } from './pipeline.ts';
import { DAG_UNIFORM_BYTES, DAG_VIEW_WORDS } from './shader/viewsWgsl.ts';
import { AHEAD_VIEW } from './shader/aheadWgsl.ts';
import { cameraCutBuffers, makeDagBuffer } from './bufferTable.ts';
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
  const { blockCount, travail, rows } = cameraCutBuffers(packed),
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
    const clusters = makeDagBuffer(own, rows.clusters);
    const nodes = makeDagBuffer(own, rows.nodes);
    const uniforms = own({
      size: DAG_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Descent queue 0, then draw flags, then the cone word `dagWanted` keeps for `dagMask` (the
    // cone verdict and the cut rule's two comparisons), then the live-cluster list, then the
    // candidate list — which also serves as the previous frame's drawn journal —, then the
    // remaining queues, then each page's last use (`shader/lastUseWgsl.ts`): never read by the
    // CPU, which still only copies draw flags.
    const flags = makeDagBuffer(own, rows.flags);
    // Three argument words, of which the last two are one once and for all: only the first is
    // copied, once per indirect dispatch. Passes following each other, one buffer is enough.
    const dispatchArgs = own({
      size: 16,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(dispatchArgs, 0, new Uint32Array([0, 1, 1, 0]));
    const list = createDagList(own, listCap, residentCut);
    // No extra storage buffer, a stage's ceiling is already reached; arming words go to the
    // dispatch argument, hence the copy source.
    const work = makeDagBuffer(own, rows.work);
    const pageCones = makeDagBuffer(own, rows.pageCones);
    const frames = createCameraFrames(device, frameData, worldCount, own, packed.worlds);
    const group = {
      clusters,
      nodes,
      views: uniforms,
      flags,
      out: list.output,
      work,
      cold: pageCones,
    };
    const pipeline = await createDagPipeline(device, group, frames);
    if (!pipeline) {
      for (const buffer of buffers) buffer.destroy();
      return undefined;
    }
    const upload = (target: GPUBuffer, size: number, source: Float32Array) => {
      const copy = new Uint8Array(size);
      if (source.byteLength)
        copy.set(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
      device.queue.writeBuffer(target, 0, copy);
    };
    upload(clusters, rows.clusters.size, packed.clusters);
    upload(nodes, rows.nodes.size, packed.nodes);
    upload(pageCones, rows.pageCones.size, packed.pageCones);
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
