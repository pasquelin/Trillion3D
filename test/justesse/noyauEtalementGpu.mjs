// Spread kernel of the transparent plan, launched in a Chromium WebGPU page: four dispatches on
// a single bind group, then readout of its two outputs — the instance list and the indirect
// arguments. Written apart from its comparison (`etalement-transparents-gpu.mjs`), like the
// other "GPU actually run" kernels.
import { dansPageWebgpu } from './pageWebgpu.mjs';

/** The kernel, launched in the page: four dispatches, then readout of the two outputs. */
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
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: arg.uniBytes },
      },
      ...arg.types.map((type, i) => ({
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
      { binding: 0, resource: { buffer: uniforms, size: arg.uniBytes } },
      ...buffers.map((buffer, i) => ({ binding: i + 1, resource: { buffer } })),
    ],
  });
  const encoder = device.createCommandEncoder();
  const passe = encoder.beginComputePass();
  passe.setBindGroup(0, groupe, [0]);
  // Layout, names and dispatches come from the production module: this bench replays the shipped
  // kernel, it does not describe the contract a second time.
  for (let step = 0; step < arg.noms.length; step++) {
    passe.setPipeline(
      device.createComputePipeline({
        layout: pipelineLayout,
        compute: { module, entryPoint: arg.noms[step] },
      }),
    );
    passe.dispatchWorkgroups(arg.lancements[step]);
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

/** Opens the page, launches the kernel there, and returns what the GPU wrote. */
export const etalementGpu = (arg) => dansPageWebgpu(dansLaPage, arg);
