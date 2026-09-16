// Le noyau WGSL de sélection du DAG réellement exécuté dans Chromium WebGPU : les tampons empaquetés
// par `packDagSelection`, les uniformes de `writeDagUniforms`, les passes `dagPrepare` à `dagMask`
// dans l'ordre du moteur (coupe non résidente), puis la relecture de la sortie du GPU. Playwright
// vient de `render-tech-lab`, en lecture seule.
import { DAG_SELECTION_SHADER } from '../../gpuDagShader.ts';
import { dansPageWebgpu } from './pageWebgpu.mjs';
import { writeDagUniforms } from '../../gpuDagUniforms.ts';
import { SELECTION_UNIFORM_BYTES, SELECTION_WORKGROUP } from '../../gpuSelection.ts';
import { FRAME_VEC4 } from '../../gpuDagTypes.ts';

const octets = (vue) => Array.from(new Uint8Array(vue.buffer, vue.byteOffset, vue.byteLength));

/** Un cas empaqueté, prêt à traverser vers la page : octets bruts, les entiers des clusters compris. */
function versPage(nom, packed, uniforms) {
  const uni = new Float32Array(SELECTION_UNIFORM_BYTES / 4);
  writeDagUniforms(uni, packed, uniforms, false);
  const frames = new Float32Array(Math.max(1, packed.worldCount) * FRAME_VEC4 * 4);
  for (let w = 0; w < packed.worldCount; w++)
    frames[(w * FRAME_VEC4 + 6) * 4] = packed.worldStretch[w];
  return {
    nom,
    pageCount: packed.pageCount,
    nodeCount: packed.nodeCount,
    worldCount: Math.max(1, packed.worldCount),
    clusters: octets(packed.clusters),
    nodes: octets(packed.nodes),
    worlds: octets(packed.worlds),
    pageCones: octets(packed.pageCones),
    frames: octets(frames),
    uniforms: octets(uni),
  };
}

/** Exécuté dans la page : un pipeline, tous les cas, la sortie `Output` relue pour chacun. */
async function executer({ shader, cas, workgroup }) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const { module, compilation } = await appareil.compile(shader);
  if (compilation.length) return { compilation, erreurs };
  const lu = 'read-only-storage',
    ecrit = 'storage';
  const acces = [lu, lu, 'uniform', ecrit, ecrit, ecrit, lu, ecrit, lu].map((type, binding) => ({
    binding,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type },
  }));
  const layout = device.createBindGroupLayout({ entries: acces });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const etape = (entryPoint) =>
    device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
  const etapes = ['dagPrepare', 'dagLevel0', 'dagWanted', 'dagMask'].map(etape);
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const tampon = (taille, octetsSource, usage = STORAGE) => {
    const buffer = device.createBuffer({
      size: Math.max(taille, octetsSource?.length ?? 0),
      usage,
    });
    if (octetsSource) device.queue.writeBuffer(buffer, 0, new Uint8Array(octetsSource));
    return buffer;
  };
  const resultats = [];
  for (const c of cas) {
    const sortieOctets = 16 + c.pageCount * 4;
    // Les mêmes régions que le moteur : la liste des vivantes prolonge les drapeaux, les compteurs
    // des blocs et de la liste prolongent les seuils.
    const blocs = Math.ceil(c.pageCount / workgroup);
    const buffers = [
      tampon(64, c.clusters),
      tampon(64, c.nodes),
      tampon(256, c.uniforms, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      tampon(Math.max(4, (c.nodeCount + c.pageCount * 3) * 4)),
      tampon(sortieOctets),
      tampon(Math.max(8, (c.worldCount * 2 + blocs * 2 + 2) * 4)),
      tampon(64, c.worlds),
      tampon(16, c.frames),
      tampon(48, c.pageCones),
    ];
    const lecture = device.createBuffer({
      size: sortieOctets,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const group = device.createBindGroup({
      layout,
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    const comptes = [
      Math.max(c.worldCount, blocs),
      Math.max(1, c.nodeCount),
      c.pageCount,
      c.pageCount,
    ];
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setBindGroup(0, group);
    etapes.forEach((pipeline, i) => {
      pass.setPipeline(pipeline);
      pass.dispatchWorkgroups(Math.max(1, Math.ceil(comptes[i] / workgroup)));
    });
    pass.end();
    encoder.copyBufferToBuffer(buffers[4], 0, lecture, 0, sortieOctets);
    device.queue.submit([encoder.finish()]);
    await lecture.mapAsync(GPUMapMode.READ);
    const ints = new Uint32Array(lecture.getMappedRange().slice(0));
    lecture.unmap();
    const count = Math.min(ints[0], c.pageCount);
    resultats.push({
      nom: c.nom,
      pages: Array.from(ints.subarray(4, 4 + count)).sort((a, b) => a - b),
      frustumRejected: ints[1],
      overflow: ints[3],
    });
    for (const buffer of [...buffers, lecture]) buffer.destroy();
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, resultats, erreurs };
}

/**
 * Lance le noyau GPU sur chaque `{ nom, packed, uniforms }` et rend les pages que le GPU a
 * sélectionnées. `shader` remplace le texte du noyau pour comparer deux versions sur les mêmes cas.
 */
export async function selectionGpu(cas, shader = DAG_SELECTION_SHADER) {
  return await dansPageWebgpu(executer, {
    shader,
    cas: cas.map(({ nom, packed, uniforms }) => versPage(nom, packed, uniforms)),
    workgroup: SELECTION_WORKGROUP,
  });
}
