// Le noyau d'étalement du plan transparent, lancé dans une page Chromium WebGPU : quatre
// dispatches sur un seul groupe de liaison, puis la relecture de ses deux sorties — la liste
// d'instances et les arguments indirects. Écrit à part de sa comparaison
// (`etalement-transparents-gpu.mjs`), comme les autres noyaux « GPU réellement exécuté ».
import { dansPageWebgpu } from './pageWebgpu.mjs';

/** Le noyau, lancé dans la page : quatre dispatches, puis la relecture des deux sorties. */
async function dansLaPage(arg) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return null;
  const { device } = appareil;
  const tampon = (data, usage) => {
    const buffer = device.createBuffer({
      size: Math.max(16, data.length * 4),
      usage,
      mappedAtCreation: true,
    });
    new Uint32Array(buffer.getMappedRange()).set(data);
    buffer.unmap();
    return buffer;
  };
  const LU = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
  const uniforms = tampon(arg.uni, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const buffers = [
    tampon(arg.plan, LU),
    tampon(arg.keep, LU),
    tampon(arg.draws, LU),
    tampon(arg.indirect, LU),
    tampon(arg.clusters, LU),
    tampon(new Uint32Array(arg.scratchWords), LU),
    tampon(new Uint32Array(arg.instanceWords), LU),
    tampon(new Uint32Array(arg.argsWords), LU),
  ];
  const types = [
    'read-only-storage',
    'read-only-storage',
    'read-only-storage',
    'read-only-storage',
    'read-only-storage',
    'storage',
    'storage',
    'storage',
  ];
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 48 },
      },
      ...types.map((type, i) => ({
        binding: i + 1,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type },
      })),
    ],
  });
  const { module, compilation } = await appareil.compile(arg.code);
  if (compilation.length) return { compilation };
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const groupe = device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: uniforms, size: 48 } },
      ...buffers.map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
    ],
  });
  const encoder = device.createCommandEncoder();
  const passe = encoder.beginComputePass();
  passe.setBindGroup(0, groupe, [0]);
  const tailles = [arg.uni[1], 1, arg.uni[0], arg.uni[2]];
  const noms = ['countBlendGroups', 'scanBlendGroups', 'placeBlendEntries', 'writeBlendRuns'];
  for (let step = 0; step < 4; step++) {
    passe.setPipeline(
      device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint: noms[step] },
      }),
    );
    passe.dispatchWorkgroups(step === 1 ? 1 : Math.ceil(Math.max(1, tailles[step]) / 64));
  }
  passe.end();
  const relu = [arg.instanceWords, arg.argsWords].map((mots, k) => {
    const cible = device.createBuffer({
      size: mots * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyBufferToBuffer(buffers[6 + k], 0, cible, 0, mots * 4);
    return cible;
  });
  device.queue.submit([encoder.finish()]);
  const sortie = [];
  for (const cible of relu) {
    await cible.mapAsync(GPUMapMode.READ);
    sortie.push(Array.from(new Uint32Array(cible.getMappedRange())));
    cible.unmap();
  }
  await appareil.fermer();
  return { expanded: sortie[0], args: sortie[1], compilation };
}

/** Ouvre la page, y lance le noyau, et rend ce que la carte a écrit. */
export const etalementGpu = (arg) => dansPageWebgpu(dansLaPage, arg);
