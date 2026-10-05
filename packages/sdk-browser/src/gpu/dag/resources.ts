import type { PackedDag } from './types.ts';
import { primitiveFrameWords } from './worlds.ts';
import { createCameraFrames } from './frameRanges.ts';
import { createDagPipeline } from './pipeline.ts';
import { DAG_UNIFORM_BYTES, DAG_VIEW_WORDS } from './shader/viewsWgsl.ts';
import { AHEAD_VIEW } from './shader/aheadWgsl.ts';
import { cameraCutBuffers, makeDagBuffer, type DagBufferRow } from './bufferTable.ts';
import { writeParts, type DagParts } from './split.ts';
import { createDagList, initialListCap } from './listCap.ts';
import { createDagArm } from './arm.ts';
import { DAG_ARGS_INITIAL } from './shader/armWgsl.ts';
import { validated } from '../core/errorScope.ts';

export async function createDagResources(
  device: GPUDevice,
  packed: PackedDag,
  residentCut: boolean,
  repeat: 'all' | 'head' | null = null,
  listCap = initialListCap(device.limits, packed.pageCount),
) {
  const pageCount = packed.pageCount,
    nodeCount = packed.nodeCount,
    worldCount = Math.max(1, packed.worldCount);
  // The compacted drawable-page list extends the snapshot: a header, then the ranks. One
  // contiguous copy reports both. Each is bounded by the CEILING and not by the catalogue: that
  // is what the frame copies and maps, and the worst case never happens (`layout.ts`,
  // measured by `tests/gpu/dag/cut-snapshot.gpu.ts`); a cut that keeps more grows it
  // (`listCap.ts`).
  // The buffers, the kernel's block count and the layout of `work`, one table with the device
  // check (`bufferTable.ts`): the list counters live behind the blocks in `work`, where the arming
  // kernel reads them (`arm.ts`).
  const { blockCount, workLayout, rows, parts, split } = cameraCutBuffers(packed, device.limits);
  // The camera's block, then the view ahead's (`shader/aheadWgsl.ts`).
  const uniformData = new Float32Array((AHEAD_VIEW + 1) * DAG_VIEW_WORDS);
  const frameData = primitiveFrameWords(packed);
  const buffers: GPUBuffer[] = [];
  /** A buffer of this cut's: the runtime's dispose destroys them all. */
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
    // One argument record per list without a bound, z one once and for all: x and y are armed
    // in the pass by the arming kernel, the only one that binds this buffer (`shader/armWgsl.ts`).
    const dispatchArgs = own({
      size: DAG_ARGS_INITIAL.byteLength,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(dispatchArgs, 0, DAG_ARGS_INITIAL);
    const list = createDagList(own, listCap, residentCut);
    // No extra storage buffer in the selection's group, a stage's ceiling is already reached: the
    // arming kernel reads the list counts here through its own group.
    const work = makeDagBuffer(own, rows.work);
    const coldBuffers = make(parts.pageCones),
      [pageCones] = coldBuffers;
    const frames = createCameraFrames(
      device,
      frameData,
      worldCount,
      own,
      packed.worlds,
      packed.worldSources,
    );
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
        cold: coldBuffers.slice(1),
        flags: flagParts.slice(1),
      },
    };
    // One validation scope after the other: the device's scopes are one stack, and two built
    // together would each pop the other's.
    const pipeline = await createDagPipeline(device, group, frames, split);
    const arm =
      pipeline &&
      (await validated(device, () => createDagArm(device, work, dispatchArgs, workLayout)));
    if (!pipeline || !arm) {
      for (const buffer of buffers) buffer.destroy();
      return undefined;
    }
    /** A table as its parts: what a host write spans (`writeParts`). */
    const partsOf = (buffers: GPUBuffer[], list: DagBufferRow[]): DagParts => ({
      buffers,
      bytes: buffers.length > 1 ? list[0].size : Number.MAX_SAFE_INTEGER,
    });
    const nodeParts = partsOf(tables.nodes, parts.nodes),
      coldParts = partsOf(coldBuffers, parts.pageCones);
    // Each part its own span; a buffer past its table's bytes (a least size) starts zeroed.
    for (const [target, source] of [
      [partsOf(tables.clusters, parts.clusters), packed.clusters],
      [nodeParts, packed.nodes],
      [coldParts, packed.pageCones],
    ] as const)
      writeParts(
        device,
        target,
        0,
        source.buffer as ArrayBuffer,
        source.byteOffset,
        source.byteLength,
      );
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
      uniformData,
      frameData,
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
      nodeParts,
      coldParts,
      ...pipeline,
      ...arm,
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
