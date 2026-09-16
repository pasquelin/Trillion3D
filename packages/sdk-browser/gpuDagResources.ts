import { dropValidation } from './gpuErrorScope.ts';
import { SELECTION_UNIFORM_BYTES as UNIFORM_BYTES, SELECTION_WORKGROUP } from './gpuSelection.ts';
import { FRAME_VEC4, type PackedDag } from './gpuDagTypes.ts';
import { createDagPipeline } from './gpuDagPipeline.ts';

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
  // La liste compactée des pages dessinables prolonge le relevé : un compte, trois mots de calage,
  // puis les rangs. Une seule copie contiguë rapporte les deux.
  const outputBytes = 16 + pageCount * 4,
    drawnBytes = 16 + pageCount * 4,
    // Le même compte de blocs que `blockCount()` du noyau, au mot près : deux compteurs vivent
    // derrière eux dans `work` et le second est recopié vers l'argument de répartition.
    blockCount = Math.ceil(pageCount / SELECTION_WORKGROUP),
    liveGroupsOffset = (worldCount * 2 + blockCount * 2 + 1) * 4,
    readbackBytes = outputBytes + (residentCut ? drawnBytes : 0);
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
    // Les drapeaux de coupe, puis les drapeaux de dessin, puis le rejet par cone retenu par
    // `dagWanted` pour les quatre passes qui le relisent, puis la liste des grappes vivantes :
    // jamais lus par le CPU, qui ne copie toujours que les drapeaux de dessin.
    const flags = device.createBuffer({
      size: Math.max(16, (nodeCount + pageCount * 3) * 4),
      usage: STORAGE | GPUBufferUsage.COPY_SRC,
    });
    // Le seul tampon neuf du lot, et il n'est lie a aucune etape : trois mots d'argument, dont les
    // deux derniers valent un une fois pour toutes. Seul le premier est recopie a chaque image.
    const liveArgs = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(liveArgs, 0, new Uint32Array([0, 1, 1, 0]));
    const output = device.createBuffer({
      size: readbackBytes,
      usage: STORAGE | GPUBufferUsage.COPY_SRC,
    });
    // Les seuils et drapeaux de couverture par primitive, les comptes et décalages de bloc de la
    // compaction, puis le compteur des grappes vivantes et celui de leurs groupes de travail :
    // aucun tampon de stockage de plus, le plafond d'une étape est déjà atteint. Ce dernier mot part
    // vers l'argument de répartition, d'où la source de copie.
    const work = device.createBuffer({
      size: Math.max(8, (worldCount * 2 + blockCount * 2 + 2) * 4),
      usage: STORAGE | GPUBufferUsage.COPY_SRC,
    });
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
      liveArgs,
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
      liveGroupsOffset,
      uniformData,
      frameData,
      buffers,
      clusters,
      nodes,
      uniforms,
      flags,
      liveArgs,
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
