import { dropValidation } from '../core/errorScope.ts';
import {
  SELECTION_UNIFORM_BYTES as UNIFORM_BYTES,
  SELECTION_WORKGROUP,
} from '../core/selection.ts';
import { FRAME_VEC4, type PackedDag } from './types.ts';
import { createDagPipeline } from './pipeline.ts';
import { LEVEL_QUEUES } from './shader/levelWgsl.ts';
import { dagWorkLayout } from './shader/floorWgsl.ts';
import { SELECTION_HEADER_WORDS, selectionListCap } from './layout.ts';

export async function createDagResources(
  device: GPUDevice,
  packed: PackedDag,
  residentCut: boolean,
  repeat: 'tout' | 'tete' | null = null,
) {
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const pageCount = packed.pageCount,
    nodeCount = packed.nodeCount,
    worldCount = Math.max(1, packed.worldCount);
  // The compacted drawable-page list extends the snapshot: a header, then the ranks. One
  // contiguous copy reports both. Each is bounded by the CEILING and not by the catalogue: that
  // is what the frame copies and maps, and the worst case never happens (`layout.ts`,
  // measured by `tests/browser/probes/releve-coupe-gpu.ts`).
  const listCap = selectionListCap(pageCount),
    headBytes = SELECTION_HEADER_WORDS * 4,
    outputBytes = headBytes + listCap * 4,
    drawnBytes = headBytes + listCap * 4,
    // The same block count as the kernel's `blockCount()`, word for word: two counters live
    // behind them in `work` and the second is copied to the dispatch argument.
    blockCount = Math.ceil(pageCount / SELECTION_WORKGROUP),
    // Layout of `work` comes from `dagWorkLayout`, which sets it for the kernel as for the
    // benches; here only the byte offsets a copy to the argument asks for are taken.
    travail = dagWorkLayout(blockCount, worldCount),
    liveGroupsOffset = travail.liveGroups * 4,
    candGroupsOffset = travail.candGroups * 4,
    drawnGroupsOffset = travail.drawnGroups * 4,
    readbackBytes = outputBytes + (residentCut ? drawnBytes : 0);
  const uniformData = new Float32Array(UNIFORM_BYTES / 4);
  const frameData = new Float32Array(worldCount * FRAME_VEC4 * 4),
    frameInts = new Uint32Array(frameData.buffer);
  for (let w = 0; w < packed.worldCount; w++) {
    frameData[(w * FRAME_VEC4 + 6) * 4] = packed.worldStretch[w];
    // The primitive's root travels with its stretch: prepare deposits it in pass 0's queue
    // without one more storage buffer bound to the stage.
    frameInts[(w * FRAME_VEC4 + 6) * 4 + 1] = packed.rootNodes[w];
  }
  const buffers: GPUBuffer[] = [];
  try {
    const clusters = device.createBuffer({
      label: 'WG DAG clusters',
      size: Math.max(64, packed.clusters.byteLength),
      usage: STORAGE,
    });
    const nodes = device.createBuffer({
      label: 'WG DAG nodes',
      size: Math.max(64, packed.nodes.byteLength),
      usage: STORAGE,
    });
    const uniforms = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Descent queue 0, then draw flags, then the cone rejection kept by `dagWanted` for the four
    // passes that reread it, then the live-cluster list, then the candidate list — which also
    // serves as the previous frame's drawn journal —, then the remaining queues: never read by
    // the CPU, which still only copies draw flags.
    const flags = device.createBuffer({
      label: 'WG DAG flags',
      size: Math.max(16, (nodeCount * LEVEL_QUEUES + pageCount * 4) * 4),
      usage: STORAGE | GPUBufferUsage.COPY_SRC,
    });
    // Three argument words, of which the last two are one once and for all: only the first is
    // copied, once per indirect dispatch. Passes following each other, one buffer is enough.
    const dispatchArgs = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(dispatchArgs, 0, new Uint32Array([0, 1, 1, 0]));
    const output = device.createBuffer({
      label: 'WG DAG readback',
      size: readbackBytes,
      usage: STORAGE | GPUBufferUsage.COPY_SRC,
    });
    // No extra storage buffer, a stage's ceiling is already reached; arming words go to the
    // dispatch argument, hence the copy source.
    const work = device.createBuffer({
      label: 'WG DAG work',
      size: Math.max(8, travail.words * 4),
      usage: STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const worlds = device.createBuffer({
      label: 'WG DAG worlds',
      size: Math.max(64, packed.worlds.byteLength),
      usage: STORAGE,
    });
    const frames = device.createBuffer({
      size: Math.max(16, frameData.byteLength),
      usage: STORAGE,
    });
    const pageCones = device.createBuffer({
      label: 'WG DAG page cones',
      size: Math.max(48, packed.pageCones.byteLength),
      usage: STORAGE,
    });
    const readback = [
      device.createBuffer({
        size: readbackBytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
      device.createBuffer({
        size: readbackBytes,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }),
    ];
    buffers.push(
      clusters,
      nodes,
      uniforms,
      flags,
      dispatchArgs,
      output,
      work,
      worlds,
      frames,
      pageCones,
      ...readback,
    );
    const pipeline = await createDagPipeline(device, {
      clusters,
      nodes,
      uniforms,
      flags,
      output,
      work,
      worlds,
      frames,
      pageCones,
    });
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
    upload(clusters, Math.max(64, packed.clusters.byteLength), packed.clusters);
    upload(nodes, Math.max(64, packed.nodes.byteLength), packed.nodes);
    upload(worlds, Math.max(64, packed.worlds.byteLength), packed.worlds);
    upload(frames, Math.max(16, frameData.byteLength), frameData);
    upload(pageCones, Math.max(48, packed.pageCones.byteLength), packed.pageCones);
    return {
      device,
      packed,
      residentCut,
      repeat,
      pageCount,
      nodeCount,
      worldCount,
      blockCount,
      outputBytes,
      readbackBytes,
      levelSizes: packed.levelSizes,
      liveGroupsOffset,
      candGroupsOffset,
      drawnGroupsOffset,
      uniformData,
      frameData,
      buffers,
      clusters,
      nodes,
      uniforms,
      flags,
      dispatchArgs,
      output,
      work,
      worlds,
      frames,
      pageCones,
      readback,
      ...pipeline,
    };
  } catch {
    await dropValidation(device);
    for (const buffer of buffers)
      try {
        buffer.destroy();
      } catch {
        /* Partial setup must not leak. */
      }
    return undefined;
  }
}
