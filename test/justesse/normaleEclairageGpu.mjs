// Les normales d'éclairage réellement calculées par le GPU : `NORMAL_TRANSFORM_WGSL` et
// `STANDARD_LIGHTING_WGSL` — les textes que le moteur assemble dans `visibilityShaderShade.ts` et
// `webgpuPagesShaders.ts` — exécutés tels quels dans Chromium WebGPU. Chaque cas donne aussi la
// normale monde vraie, calculée en f64 sur le CPU : la même formule d'éclairage est évaluée deux
// fois sur le GPU, avec la normale rendue puis avec la vraie, pour que l'écart de luminance ne
// dépende d'aucune réécriture CPU de la BRDF.
import assert from 'node:assert/strict';
import { NORMAL_TRANSFORM_WGSL, STANDARD_LIGHTING_WGSL } from '../../packages/sdk-browser/standardLighting.ts';
import { dansPageWebgpu } from './pageWebgpu.mjs';

export const GROUPE = 64;

/**
 * LES SUBSTITUTIONS DE `xformNormal`, pour éprouver la PREUVE elle-même.
 *
 * Une preuve qui ne tombe sur aucune faute ne prouve rien, et c'est ce qui était arrivé ici : le
 * critère d'écart prenait la valeur absolue du produit scalaire et acceptait `atan2(0, 0) = 0`, si
 * bien qu'une normale retournée ou perdue passait. Ces expressions WGSL altèrent la SORTIE de
 * `xformNormal` à l'endroit exact où l'éclairage la lit — le nuanceur livré est compilé et exécuté
 * tel quel, sur le vrai GPU, et seule sa valeur de retour change. Un test qui les passe à
 * `eclairageGpu` doit voir la preuve ÉCHOUER ; si elle reste verte, c'est le critère qui est faux.
 */
export const SUBSTITUTIONS = {
  /** Le nuanceur livré, intact : la seule qui doit laisser la preuve verte. */
  aucune: 'N',
  /** N → −N : la normale retournée, ce qu'une inverse-transposée rate le plus souvent. */
  opposee: '-N',
  /** N → 0 : la normale perdue, que `normalize` rendra NaN et qu'un angle nul déclarait juste. */
  nulle: 'vec3f(0.0,0.0,0.0)',
};

/** Vue, albédo et hémisphère fixes : seule l'orientation de la normale change d'un cas à l'autre. */
export const SHADER_ECLAIRAGE = (transform = NORMAL_TRANSFORM_WGSL, substitution = 'N') => `
struct Cas{world:mat4x4f,normale:vec4f,vraie:vec4f,lumiere:vec4f,matiere:vec4f,}
@group(0) @binding(0) var<storage, read> cas:array<Cas>;
@group(0) @binding(1) var<storage, read_write> out:array<vec4f>;
${STANDARD_LIGHTING_WGSL}
${transform}
fn eprouve(N:vec3f)->vec3f{return ${substitution};}
@compute @workgroup_size(${GROUPE}) fn normales(@builtin(global_invocation_id) gid:vec3u){
 let i=gid.x;
 if(i>=arrayLength(&cas)){return;}
 let c=cas[i];
 let N=eprouve(xformNormal(c.world,c.normale.xyz));
 let V=vec3f(0.0,0.0,1.0);
 let rgb=vec3f(0.8,0.7,0.6);let sky=vec3f(0.6,0.7,0.9);let ground=vec3f(0.2,0.18,0.15);
 let lit=standardLighting(rgb,c.matiere.x,c.matiere.y,N,V,c.lumiere,sky,ground,1.0);
 let vrai=standardLighting(rgb,c.matiere.x,c.matiere.y,uniteOuZero(c.vraie.xyz),V,c.lumiere,sky,ground,1.0);
 out[i*3u]=vec4f(N,0.0);
 out[i*3u+1u]=vec4f(lit,0.0);
 out[i*3u+2u]=vec4f(vrai,0.0);
}`;

/** Exécuté dans la page : un pipeline, tous les cas d'un coup, la sortie relue. */
async function executer({ shader, entree, nombre, groupe }) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const { module, compilation } = await appareil.compile(shader);
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
  const info = await appareil.fermer();
  return { adaptateur: info.court, valeurs, erreurs };
}

/**
 * Lance le shader sur chaque cas de `cas` (voir `normaleEclairageCas.mjs`) et rend, pour chacun, la
 * normale que le GPU a produite et les deux couleurs éclairées.
 *
 * `transform` remplace le texte de `NORMAL_TRANSFORM_WGSL` pour comparer deux versions sur les mêmes
 * cas ; `substitution` altère la sortie de `xformNormal` sans toucher au nuanceur livré, pour
 * éprouver le critère de la preuve (voir `SUBSTITUTIONS`). Les deux sont établies, pas espérées :
 * l'expression doit apparaître une fois et une seule dans le texte assemblé, et `xformNormal` doit
 * y être appelée une fois — une substitution qui ne prend pas rendrait une campagne verte qui n'a
 * rien éprouvé.
 */
export async function eclairageGpu(cas, options = {}) {
  const { transform = NORMAL_TRANSFORM_WGSL, substitution = SUBSTITUTIONS.aucune } = options;
  const shader = SHADER_ECLAIRAGE(transform, substitution);
  const compte = (motif) => shader.split(motif).length - 1;
  assert.equal(compte(`return ${substitution};`), 1, `substitution « ${substitution} » non posée`);
  assert.equal(compte('eprouve(xformNormal('), 1, 'xformNormal n’est plus la sortie éprouvée');
  const entree = new Float32Array(cas.length * 32);
  cas.forEach((c, i) => {
    entree.set(c.world, i * 32);
    entree.set([...c.normale, 0], i * 32 + 16);
    entree.set([...c.vraie, 0], i * 32 + 20);
    entree.set(c.lumiere, i * 32 + 24);
    entree.set([c.metal, c.rugosite, 0, 0], i * 32 + 28);
  });
  const brut = await dansPageWebgpu(executer, {
    shader,
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
