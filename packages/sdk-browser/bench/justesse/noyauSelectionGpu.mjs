// Le noyau WGSL de sélection du DAG réellement exécuté dans Chromium WebGPU : les tampons empaquetés
// par `packDagSelection`, les uniformes de `writeDagUniforms`, les passes `dagReset` à `dagMask`
// dans l'ordre du moteur (coupe non résidente), puis la relecture de la sortie du GPU. Playwright
// vient de `render-tech-lab`, en lecture seule.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { DAG_SELECTION_SHADER } from '../../gpuDagShader.ts';
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
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return { indisponible: 'aucun adaptateur WebGPU' };
  const device = await adapter.requestDevice();
  const erreurs = [];
  device.addEventListener('uncapturederror', (event) => erreurs.push(event.error.message));
  const module = device.createShaderModule({ code: shader });
  const compilation = (await module.getCompilationInfo()).messages
    .filter((message) => message.type === 'error')
    .map((message) => message.message);
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
  const etapes = ['dagReset', 'dagPlanes', 'dagNodes', 'dagWanted', 'dagMask'].map(etape);
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
    const buffers = [
      tampon(64, c.clusters),
      tampon(64, c.nodes),
      tampon(256, c.uniforms, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
      tampon(Math.max(4, (c.nodeCount + c.pageCount * 2) * 4)),
      tampon(sortieOctets),
      tampon(Math.max(8, c.worldCount * 8)),
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
      c.worldCount,
      c.worldCount,
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
  await device.queue.onSubmittedWorkDone();
  const info = adapter.info;
  device.destroy();
  return { adaptateur: `${info.vendor} ${info.architecture}`, resultats, erreurs };
}

/**
 * Lance le noyau GPU sur chaque `{ nom, packed, uniforms }` et rend les pages que le GPU a
 * sélectionnées. `shader` remplace le texte du noyau pour comparer deux versions sur les mêmes cas.
 */
export async function selectionGpu(cas, shader = DAG_SELECTION_SHADER) {
  const labRoot = process.env.LAB_ROOT ?? resolve('../render-tech-lab');
  const { chromium } = createRequire(resolve(labRoot, 'package.json'))('playwright');
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>WebGeometry noyau de sélection</title>');
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    return await page.evaluate(executer, {
      shader,
      cas: cas.map(({ nom, packed, uniforms }) => versPage(nom, packed, uniforms)),
      workgroup: SELECTION_WORKGROUP,
    });
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
}
