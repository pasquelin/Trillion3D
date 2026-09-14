import { SELECTION_UNIFORM_BYTES as UNIFORM_BYTES } from './gpuSelection.ts';
import { FRAME_VEC4, type PackedDag } from './gpuDagTypes.ts';
import { createDagPipeline } from './gpuDagPipeline.ts';

export async function createDagResources(
  device: GPUDevice,
  packed: PackedDag,
  residentCut: boolean,
) {
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const pageCount = packed.pageCount,
    nodeCount = packed.nodeCount,
    worldCount = Math.max(1, packed.worldCount);
  const outputBytes = 16 + pageCount * 4,
    readbackBytes = outputBytes + (residentCut ? pageCount * 4 : 0);
  const uniformData = new Float32Array(UNIFORM_BYTES / 4);
  const frameData = new Float32Array(worldCount * FRAME_VEC4 * 4);
  for (let w = 0; w < packed.worldCount; w++)
    frameData[(w * FRAME_VEC4 + 6) * 4] = packed.worldStretch[w];
  const buffers: GPUBuffer[] = [];
  try {
    const clusters = device.createBuffer({
      size: Math.max(64, packed.clusters.byteLength),
      usage: STORAGE,
    });
    const nodes = device.createBuffer({
      size: Math.max(64, packed.nodes.byteLength),
      usage: STORAGE,
    });
    const uniforms = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const flags = device.createBuffer({
      size: Math.max(4, (nodeCount + pageCount) * 4),
      usage: STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const output = device.createBuffer({
      size: outputBytes,
      usage: STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const work = device.createBuffer({ size: Math.max(8, worldCount * 2 * 4), usage: STORAGE });
    const worlds = device.createBuffer({
      size: Math.max(64, packed.worlds.byteLength),
      usage: STORAGE,
    });
    const frames = device.createBuffer({
      size: Math.max(16, frameData.byteLength),
      usage: STORAGE,
    });
    const pageCones = device.createBuffer({
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
      pageCount,
      nodeCount,
      worldCount,
      outputBytes,
      uniformData,
      frameData,
      buffers,
      clusters,
      nodes,
      uniforms,
      flags,
      output,
      work,
      worlds,
      frames,
      pageCones,
      readback,
      ...pipeline,
    };
  } catch {
    if (typeof device.popErrorScope === 'function') await device.popErrorScope().catch(() => {});
    for (const buffer of buffers)
      try {
        buffer.destroy();
      } catch {
        /* Partial setup must not leak. */
      }
    return undefined;
  }
}
