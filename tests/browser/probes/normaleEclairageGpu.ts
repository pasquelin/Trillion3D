// Lighting normals actually computed by the GPU: `NORMAL_TRANSFORM_WGSL` and
// `STANDARD_LIGHTING_WGSL` — the texts the engine assembles in `visibilityShaderShade.ts` and
// `webgpuPagesShaders.ts` — run as-is in Chromium WebGPU. Each case also gives the
// true world normal, computed in f64 on the CPU: the same lighting formula is evaluated twice
// on the GPU, with the rendered normal then with the true one, so the luminance gap
// depends on no CPU rewrite of the BRDF.
import assert from 'node:assert/strict';
import {
  NORMAL_TRANSFORM_WGSL,
  STANDARD_LIGHTING_WGSL,
} from '../../../packages/sdk-browser/src/lighting/standardLighting.ts';
import { dansPageWebgpu } from './pageWebgpu.ts';
import type { CasEclairage, LigneGpu } from './normaleEclairageCas.ts';

export const GROUPE = 64;

/**
 * `xformNormal` SUBSTITUTIONS, to exercise the PROOF itself.
 *
 * A proof that never hits a fault proves nothing, and that is what had happened here: the
 * gap criterion took the absolute value of the dot product and accepted `atan2(0, 0) = 0`,
 * so a flipped or lost normal passed. These WGSL expressions alter `xformNormal`'s OUTPUT
 * at the exact place lighting reads it — the shipped shader is compiled and run as-is, on
 * the real GPU, and only its return value changes. A test that passes them to
 * `eclairageGpu` must see the proof FAIL; if it stays green, the criterion is wrong.
 */
export const SUBSTITUTIONS = {
  /** The shipped shader, intact: the only one that must leave the proof green. */
  aucune: 'N',
  /** N → −N: the flipped normal, what a missed inverse-transpose most often does. */
  opposee: '-N',
  /** N → 0: the lost normal, which `normalize` will turn into NaN and which a null angle used to declare correct. */
  nulle: 'vec3f(0.0,0.0,0.0)',
};

/** Fixed view, albedo and hemisphere: only the normal's orientation changes from case to case. */
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

interface ExecutionEntree {
  shader: string;
  entree: number[];
  nombre: number;
  groupe: number;
}
interface ExecutionResultat {
  indisponible?: string;
  compilation?: string[];
  adaptateur?: string;
  valeurs?: number[];
  erreurs?: string[];
}

/** Run in the page: one pipeline, every case at once, the output read back. */
async function executer({
  shader,
  entree,
  nombre,
  groupe,
}: ExecutionEntree): Promise<ExecutionResultat> {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const { module, compilation } = await appareil.compile(shader);
  if (compilation.length) return { compilation, erreurs };
  const layout = device.createBindGroupLayout({
    entries: (['read-only-storage', 'storage'] as const).map((type, binding) => ({
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
 * Runs the shader on each case in `cas` (see `normaleEclairageCas.ts`) and returns, for each,
 * the normal the GPU produced and the two lit colours.
 *
 * `transform` replaces the `NORMAL_TRANSFORM_WGSL` text to compare two versions on the same
 * cases; `substitution` alters `xformNormal`'s output without touching the shipped shader, to
 * exercise the proof criterion (see `SUBSTITUTIONS`). Both are established, not hoped for:
 * the expression must appear once and only once in the assembled text, and `xformNormal` must
 * be called once in it — a substitution that does not take would yield a green campaign that
 * exercised nothing.
 */
export async function eclairageGpu(
  cas: CasEclairage[],
  options: { transform?: string; substitution?: string } = {},
): Promise<ExecutionResultat & { lignes: Array<LigneGpu & { nom: string }> }> {
  const { transform = NORMAL_TRANSFORM_WGSL, substitution = SUBSTITUTIONS.aucune } = options;
  const shader = SHADER_ECLAIRAGE(transform, substitution);
  const compte = (motif: string): number => shader.split(motif).length - 1;
  assert.equal(compte(`return ${substitution};`), 1, `substitution "${substitution}" not applied`);
  assert.equal(compte('eprouve(xformNormal('), 1, 'xformNormal is no longer the probed output');
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
  const valeurs = brut.valeurs;
  const lignes = cas.map((c, i) => ({
    nom: c.nom,
    rendue: valeurs.slice(i * 12, i * 12 + 3),
    litRendu: valeurs.slice(i * 12 + 4, i * 12 + 7),
    litVrai: valeurs.slice(i * 12 + 8, i * 12 + 11),
  }));
  return { ...brut, lignes };
}
