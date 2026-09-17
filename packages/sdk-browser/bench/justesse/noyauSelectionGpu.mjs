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
  const frameInts = new Uint32Array(frames.buffer);
  for (let w = 0; w < packed.worldCount; w++) {
    frames[(w * FRAME_VEC4 + 6) * 4] = packed.worldStretch[w];
    // La racine de la primitive voyage avec son étirement : la descente par niveaux part d'elle.
    frameInts[(w * FRAME_VEC4 + 6) * 4 + 1] = packed.rootNodes[w];
  }
  return {
    nom,
    pageCount: packed.pageCount,
    nodeCount: packed.nodeCount,
    worldCount: Math.max(1, packed.worldCount),
    levelCount: packed.levelCount,
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
  const preparePipeline = etape('dagPrepare');
  // La descente par niveaux : la passe 0 part des racines, chaque passe suivante tourne sur les
  // trois files que `levelStep` remplit à tour de rôle (piste : `gpuDagLevelWgsl.ts`).
  const levelPipelines = [etape('dagLevel0'), etape('dagLevel1'), etape('dagLevel2')];
  const wantedPipeline = etape('dagWanted');
  const maskPipeline = etape('dagMask');
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const tampon = (taille, octetsSource, usage = STORAGE) => {
    const buffer = device.createBuffer({
      size: Math.max(taille, octetsSource?.length ?? 0),
      usage,
    });
    if (octetsSource) device.queue.writeBuffer(buffer, 0, new Uint8Array(octetsSource));
    return buffer;
  };
  const groupes = (n) => Math.max(1, Math.ceil(n / workgroup));
  const resultats = [];
  for (const c of cas) {
    const sortieOctets = 16 + c.pageCount * 4;
    const blockCount = groupes(c.pageCount);
    // Les mêmes régions que le moteur (`gpuDagResources.ts`) : après les seuils par primitive et les
    // compteurs de bloc viennent le compteur des vivantes, puis les trois files de la descente, la
    // liste des candidates et le journal des dessinées — deux mots chacun (compteur, groupes).
    const workBase = c.worldCount * 2 + blockCount * 2;
    const buffers = [
      tampon(64, c.clusters),
      tampon(64, c.nodes),
      tampon(256, c.uniforms, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      tampon(Math.max(16, (c.nodeCount * 3 + c.pageCount * 4) * 4)),
      tampon(sortieOctets),
      tampon(Math.max(8, (workBase + 12) * 4)),
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
    const encoder = device.createCommandEncoder();
    const tete = encoder.beginComputePass();
    tete.setBindGroup(0, group);
    tete.setPipeline(preparePipeline);
    tete.dispatchWorkgroups(groupes(Math.max(c.worldCount, blockCount)));
    // Passe 0 : une racine par primitive, dispatché à plat comme la préparation.
    tete.setPipeline(levelPipelines[0]);
    tete.dispatchWorkgroups(groupes(c.nodeCount));
    tete.end();
    // Chaque niveau suivant se répartit sur les seuls nœuds que le niveau précédent a retenus ; la
    // file où il écrit a été remise à zéro par le niveau qui la précède de deux, dans le noyau même.
    for (let niveau = 1; niveau < c.levelCount; niveau++) {
      const source = niveau % 3;
      const passe = encoder.beginComputePass();
      passe.setBindGroup(0, group);
      passe.setPipeline(levelPipelines[source]);
      passe.dispatchWorkgroups(groupes(c.nodeCount));
      passe.end();
    }
    // Les pages des feuilles retenues, puis leur verdict : les deux passes finales visitent au plus
    // `pageCount` grappes, un majorant sûr de la liste des candidates et de celle des vivantes.
    const fin = encoder.beginComputePass();
    fin.setBindGroup(0, group);
    fin.setPipeline(wantedPipeline);
    fin.dispatchWorkgroups(groupes(c.pageCount));
    fin.setPipeline(maskPipeline);
    fin.dispatchWorkgroups(groupes(c.pageCount));
    fin.end();
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
