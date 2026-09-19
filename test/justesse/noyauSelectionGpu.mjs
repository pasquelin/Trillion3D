// The DAG selection WGSL kernel actually run in Chromium WebGPU: buffers packed
// by `packDagSelection`, uniforms from `writeDagUniforms`, passes `dagPrepare` through `dagMask`
// in engine order (non-resident cut), then a readback of the GPU output.
import { DAG_SELECTION_SHADER } from '../../packages/sdk-browser/gpuDagShader.ts';
import { dansPageWebgpu } from './pageWebgpu.mjs';
import { writeDagUniforms } from '../../packages/sdk-browser/gpuDagUniforms.ts';
import {
  SELECTION_UNIFORM_BYTES,
  SELECTION_WORKGROUP,
} from '../../packages/sdk-browser/gpuSelection.ts';
import { FRAME_VEC4 } from '../../packages/sdk-browser/gpuDagTypes.ts';
import { dagWorkLayout } from '../../packages/sdk-browser/gpuDagFloorWgsl.ts';
import { REQUEST_PAGE_MAX } from '../../packages/sdk-browser/gpuDagRequest.ts';
import {
  OUT_DRAWN_TRIANGLES,
  OUT_SELECTED_TRIANGLES,
  OUT_TRANSPARENT_TRIANGLES,
  OUT_UNCOVERED_TRIANGLES,
  SELECTION_HEADER_WORDS,
} from '../../packages/sdk-browser/gpuDagLayout.ts';

const octets = (vue) => Array.from(new Uint8Array(vue.buffer, vue.byteOffset, vue.byteLength));

/** A packed case, ready to cross into the page: raw bytes, including cluster integers. */
function versPage(name, packed, uniforms) {
  const uni = new Float32Array(SELECTION_UNIFORM_BYTES / 4);
  writeDagUniforms(uni, packed, uniforms, false);
  const frames = new Float32Array(Math.max(1, packed.worldCount) * FRAME_VEC4 * 4);
  const frameInts = new Uint32Array(frames.buffer);
  for (let w = 0; w < packed.worldCount; w++) {
    frames[(w * FRAME_VEC4 + 6) * 4] = packed.worldStretch[w];
    // The primitive's root travels with its stretch: level descent starts from it.
    frameInts[(w * FRAME_VEC4 + 6) * 4 + 1] = packed.rootNodes[w];
  }
  const blockCount = Math.ceil(Math.max(1, packed.pageCount) / SELECTION_WORKGROUP);
  return {
    name,
    travail: dagWorkLayout(blockCount, Math.max(1, packed.worldCount)),
    pageCount: packed.pageCount,
    nodeCount: packed.nodeCount,
    worldCount: Math.max(1, packed.worldCount),
    levelCount: packed.levelSizes.length,
    clusters: octets(packed.clusters),
    nodes: octets(packed.nodes),
    worlds: octets(packed.worlds),
    pageCones: octets(packed.pageCones),
    frames: octets(frames),
    uniforms: octets(uni),
  };
}

/** Run in the page: one pipeline, every case, the `Output` read back for each. */
async function executer({ shader, cas, workgroup, entete, totaux, bitsPage }) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
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
  // Level descent: pass 0 starts from the roots, each following pass runs on the
  // three queues `levelStep` fills in turn (see `gpuDagLevelWgsl.ts`).
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
    const sortieOctets = entete * 4 + c.pageCount * 4;
    const blockCount = groupes(c.pageCount);
    // The `work` layout is the one the engine lays down, computed on the Node side and
    // carried with the case: the page has no module to import, and the bench cannot derive another.
    const travail = c.travail;
    const buffers = [
      tampon(64, c.clusters),
      tampon(64, c.nodes),
      tampon(256, c.uniforms, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      tampon(Math.max(16, (c.nodeCount * 3 + c.pageCount * 4) * 4)),
      tampon(sortieOctets),
      tampon(Math.max(8, travail.words * 4)),
      tampon(64, c.worlds),
      tampon(16, c.frames),
      tampon(48, c.pageCones),
    ];
    const lecture = device.createBuffer({
      size: sortieOctets,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    // Frame counters: what descent listed as candidates, and what `dagWanted` kept
    // live. Those two list sizes are what the five following passes reread.
    const octetsTravail = Math.max(8, travail.words * 4);
    const compteurs = device.createBuffer({
      size: octetsTravail,
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
    // The whole descent in this pass, as the engine encodes it: launches in the same pass
    // run in order and see what the previous ones wrote. Each is dispatched flat, over
    // an upper bound on its level's node count.
    tete.setPipeline(levelPipelines[0]);
    tete.dispatchWorkgroups(groupes(c.nodeCount));
    for (let niveau = 1; niveau < c.levelCount; niveau++) {
      tete.setPipeline(levelPipelines[niveau % 3]);
      tete.dispatchWorkgroups(groupes(c.nodeCount));
    }
    tete.end();
    // Pages of the kept leaves, then their verdict: the two final passes visit at most
    // `pageCount` clusters, a safe upper bound on the candidate list and the live list.
    const fin = encoder.beginComputePass();
    fin.setBindGroup(0, group);
    fin.setPipeline(wantedPipeline);
    fin.dispatchWorkgroups(groupes(c.pageCount));
    fin.setPipeline(maskPipeline);
    fin.dispatchWorkgroups(groupes(c.pageCount));
    fin.end();
    encoder.copyBufferToBuffer(buffers[4], 0, lecture, 0, sortieOctets);
    encoder.copyBufferToBuffer(buffers[5], 0, compteurs, 0, octetsTravail);
    device.queue.submit([encoder.finish()]);
    await lecture.mapAsync(GPUMapMode.READ);
    const ints = new Uint32Array(lecture.getMappedRange().slice(0));
    lecture.unmap();
    await compteurs.mapAsync(GPUMapMode.READ);
    const compteursLus = new Uint32Array(compteurs.getMappedRange().slice(0));
    compteurs.unmap();
    const count = Math.min(ints[0], c.pageCount);
    resultats.push({
      name: c.name,
      // Request words in the ORDER THE GPU WROTE THEM: that is what ranking rereads.
      // `pages` stays sorted, for proofs that compare sets.
      demandes: Array.from(ints.subarray(entete, entete + count)),
      pages: Array.from(ints.subarray(entete, entete + count))
        .map((mot) => mot & (bitsPage - 1))
        .sort((a, b) => a - b),
      frustumRejected: ints[1],
      overflow: ints[3],
      // Totals the GPU holds: this is where they are compared to the oracle's.
      selectedTriangles: ints[totaux.selected],
      transparentTriangles: ints[totaux.transparent],
      drawnTriangles: ints[totaux.drawn],
      uncoveredTriangles: ints[totaux.uncovered],
      candidates: compteursLus[travail.candCounter],
      vivantes: compteursLus[travail.liveCounter],
    });
    for (const buffer of [...buffers, lecture, compteurs]) buffer.destroy();
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, resultats, erreurs };
}

/**
 * Run the GPU kernel on each `{ name, packed, uniforms }` and return the pages the GPU
 * selected, with the sizes of the two lists the frame rereads: descent candidates and
 * `dagWanted` live ones. `shader` replaces the kernel text to compare two versions.
 */
export async function selectionGpu(cas, shader = DAG_SELECTION_SHADER) {
  // The function is SERIALIZED into the page: it only sees its argument. The readback
  // header layout therefore travels with it, instead of being reread from a module the page lacks.
  return await dansPageWebgpu(executer, {
    shader,
    cas: cas.map((c) => versPage(c.name, c.packed, c.uniforms)),
    workgroup: SELECTION_WORKGROUP,
    entete: SELECTION_HEADER_WORDS,
    bitsPage: REQUEST_PAGE_MAX,
    totaux: {
      selected: OUT_SELECTED_TRIANGLES,
      transparent: OUT_TRANSPARENT_TRIANGLES,
      drawn: OUT_DRAWN_TRIANGLES,
      uncovered: OUT_UNCOVERED_TRIANGLES,
    },
  });
}
