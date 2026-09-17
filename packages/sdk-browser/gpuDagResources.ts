import { dropValidation } from './gpuErrorScope.ts';
import { SELECTION_UNIFORM_BYTES as UNIFORM_BYTES, SELECTION_WORKGROUP } from './gpuSelection.ts';
import { FRAME_VEC4, type PackedDag } from './gpuDagTypes.ts';
import { createDagPipeline } from './gpuDagPipeline.ts';
import { LEVEL_QUEUES } from './gpuDagLevelWgsl.ts';
import { dagWorkLayout } from './gpuDagFloorWgsl.ts';
import { SELECTION_HEADER_WORDS, selectionListCap } from './gpuDagLayout.ts';

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
  // La liste compactée des pages dessinables prolonge le relevé : un entête, puis les rangs. Une seule copie contiguë rapporte les deux. Chacune est bornée par le PLAFOND
  // et non par le catalogue : c'est ce que l'image recopie et mappe, et le pire cas n'arrive jamais
  // (`gpuDagLayout.ts`, mesuré par `bench/justesse/releve-coupe-gpu.mjs`).
  const listCap = selectionListCap(pageCount),
    headBytes = SELECTION_HEADER_WORDS * 4,
    outputBytes = headBytes + listCap * 4,
    drawnBytes = headBytes + listCap * 4,
    // Le même compte de blocs que `blockCount()` du noyau, au mot près : deux compteurs vivent
    // derrière eux dans `work` et le second est recopié vers l'argument de répartition.
    blockCount = Math.ceil(pageCount / SELECTION_WORKGROUP),
    // La disposition de `work` vient de `dagWorkLayout`, qui la pose pour le noyau comme pour les
    // bancs ; ici on n'en tire que les décalages d'octets qu'une copie vers l'argument demande.
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
    // La racine de la primitive voyage avec son étirement : la préparation la dépose dans la file de
    // la passe 0 sans qu'un tampon de stockage de plus soit lié à l'étape.
    frameInts[(w * FRAME_VEC4 + 6) * 4 + 1] = packed.rootNodes[w];
  }
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
    // La file 0 de la descente, puis les drapeaux de dessin, puis le rejet par cone retenu par
    // `dagWanted` pour les quatre passes qui le relisent, puis la liste des grappes vivantes, puis la
    // liste des candidates — qui sert aussi de journal des dessinées de l'image précédente —, puis
    // les files qui restent : jamais lus par le CPU, qui ne copie toujours que les drapeaux de dessin.
    const flags = device.createBuffer({
      label: 'WG DAG flags',
      size: Math.max(16, (nodeCount * LEVEL_QUEUES + pageCount * 4) * 4),
      usage: STORAGE | GPUBufferUsage.COPY_SRC,
    });
    // Trois mots d'argument, dont les deux derniers valent un une fois pour toutes : seul le premier
    // est recopié, une fois par répartition indirecte. Les passes se suivant, un seul tampon suffit.
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
    // Aucun tampon de stockage de plus, le plafond d'une étape est déjà atteint ; les mots d'armement
    // partent vers l'argument de répartition, d'où la source de copie.
    const work = device.createBuffer({
      size: Math.max(8, travail.words * 4),
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
