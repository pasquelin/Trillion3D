// Les normales d'éclairage réellement calculées par le GPU : `NORMAL_TRANSFORM_WGSL` et
// `STANDARD_LIGHTING_WGSL` — les textes que le moteur assemble dans `visibilityShaderShade.ts` et
// `webgpuPagesShaders.ts` — exécutés tels quels dans Chromium WebGPU. Chaque cas donne aussi la
// normale monde vraie, calculée en f64 sur le CPU : la même formule d'éclairage est évaluée deux
// fois sur le GPU, avec la normale rendue puis avec la vraie, pour que l'écart de luminance ne
// dépende d'aucune réécriture CPU de la BRDF.
import { NORMAL_TRANSFORM_WGSL, STANDARD_LIGHTING_WGSL } from '../../standardLighting.ts';
import { dansPageWebgpu } from './pageWebgpu.mjs';

export const GROUPE = 64;
/** Vue, albédo et hémisphère fixes : seule l'orientation de la normale change d'un cas à l'autre. */
export const SHADER_ECLAIRAGE = (transform = NORMAL_TRANSFORM_WGSL) => `
struct Cas{world:mat4x4f,normale:vec4f,vraie:vec4f,lumiere:vec4f,matiere:vec4f,}
@group(0) @binding(0) var<storage, read> cas:array<Cas>;
@group(0) @binding(1) var<storage, read_write> out:array<vec4f>;
${STANDARD_LIGHTING_WGSL}
${transform}
@compute @workgroup_size(${GROUPE}) fn normales(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;
 if(i>=arrayLength(&cas)){return;}
 let c=cas[i];
 let N=xformNormal(c.world,c.normale.xyz);
 let V=vec3f(0.0,0.0,1.0);
 let rgb=vec3f(0.8,0.7,0.6);let sky=vec3f(0.6,0.7,0.9);let ground=vec3f(0.2,0.18,0.15);
 let lit=standardLighting(rgb,c.matiere.x,c.matiere.y,N,V,c.lumiere,sky,ground,1.0);
 let vrai=standardLighting(rgb,c.matiere.x,c.matiere.y,normalize(c.vraie.xyz),V,c.lumiere,sky,ground,1.0);
 out[i*3u]=vec4f(N,0.0);
 out[i*3u+1u]=vec4f(lit,0.0);
 out[i*3u+2u]=vec4f(vrai,0.0);
}`;

/** Exécuté dans la page : un pipeline, tous les cas d'un coup, la sortie relue. */
async function executer({ shader, entree, nombre, groupe }) {
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
  const layout = device.createBindGroupLayout({
    entries: ['read-only-storage', 'storage'].map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module, entryPoint: 'normales' },
  });
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const entrees = device.createBuffer({ size: entree.length, usage: STORAGE });
  device.queue.writeBuffer(entrees, 0, new Uint8Array(entree));
  const sortieOctets = nombre * 3 * 16;
  const sorties = device.createBuffer({ size: sortieOctets, usage: STORAGE });
  const lecture = device.createBuffer({
    size: sortieOctets,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const group = device.createBindGroup({
    layout,
    entries: [entrees, sorties].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(Math.ceil(nombre / groupe));
  pass.end();
  encoder.copyBufferToBuffer(sorties, 0, lecture, 0, sortieOctets);
  device.queue.submit([encoder.finish()]);
  await lecture.mapAsync(GPUMapMode.READ);
  const valeurs = Array.from(new Float32Array(lecture.getMappedRange().slice(0)));
  lecture.unmap();
  await device.queue.onSubmittedWorkDone();
  const info = adapter.info;
  device.destroy();
  return { adaptateur: `${info.vendor} ${info.architecture}`, valeurs, erreurs };
}

/**
 * Lance le shader sur chaque cas de `cas` (voir `normaleEclairageCas.mjs`) et rend, pour chacun,
 * la normale que le GPU a produite et les deux couleurs éclairées. `transform` remplace le texte de
 * `NORMAL_TRANSFORM_WGSL` pour comparer deux versions sur les mêmes cas.
 */
export async function eclairageGpu(cas, transform = NORMAL_TRANSFORM_WGSL) {
  const entree = new Float32Array(cas.length * 32);
  cas.forEach((c, i) => {
    entree.set(c.world, i * 32);
    entree.set([...c.normale, 0], i * 32 + 16);
    entree.set([...c.vraie, 0], i * 32 + 20);
    entree.set(c.lumiere, i * 32 + 24);
    entree.set([c.metal, c.rugosite, 0, 0], i * 32 + 28);
  });
  const brut = await dansPageWebgpu(executer, {
    shader: SHADER_ECLAIRAGE(transform),
    entree: Array.from(new Uint8Array(entree.buffer)),
    nombre: cas.length,
    groupe: GROUPE,
  });
  if (!brut.valeurs) return { ...brut, lignes: [] };
  const lignes = cas.map((c, i) => ({
    nom: c.nom,
    rendue: brut.valeurs.slice(i * 12, i * 12 + 3),
    litRendu: brut.valeurs.slice(i * 12 + 4, i * 12 + 7),
    litVrai: brut.valeurs.slice(i * 12 + 8, i * 12 + 11),
  }));
  return { ...brut, lignes };
}
