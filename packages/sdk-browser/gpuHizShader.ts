import { ST_REJECTED, ST_REJECTED_TRIANGLES, ST_TESTED } from './gpuPartitionContract.ts';
import { HIZ_FAR_WGSL } from './gpuHizRectWgsl.ts';

/** `GPUShaderStage.COMPUTE`, écrit en clair : ce module est aussi lu depuis Node, sans ce global. */
const COMPUTE = 4;

/**
 * Les liaisons du groupe 0, publiées sous le WGSL qui les déclare. La disposition de production et
 * les preuves navigateur les LISENT ici — aucune ne les recopie, donc aucune ne peut prendre du
 * retard sur le nuanceur. C'est cet écart qui avait rendu `hiz-webgpu.browser.mjs` rouge : sa copie
 * s'était arrêtée à `@binding(4)` pendant que `state` entrait en 5.
 */
export function hizBindEntries(uniformBytes: number): GPUBindGroupLayoutEntry[] {
  return [
    { binding: 0, visibility: COMPUTE, buffer: { type: 'storage' } },
    { binding: 1, visibility: COMPUTE, texture: { sampleType: 'unfilterable-float' } },
    {
      binding: 2,
      visibility: COMPUTE,
      buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: uniformBytes },
    },
    { binding: 3, visibility: COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 4, visibility: COMPUTE, buffer: { type: 'storage' } },
    { binding: 5, visibility: COMPUTE, buffer: { type: 'storage' } },
  ];
}

/**
 * Les trois noyaux de la pyramide Hi-Z. Le test ne reçoit plus ni compte ni octets du processeur :
 * il lit le nombre de boîtes et écrit ses propres compteurs d'élimination dans l'état que la
 * partition GPU tient, et les boîtes sont celles que la partition a empaquetées dans la même
 * soumission. Aucune valeur n'y est déduite : un verdict est écrit, ou la ligne reste à zéro.
 */
export const HIZ_SHADER = `struct Uni{a:u32,b:u32,c:u32,d:u32,e:u32,f:u32,g:u32,h:u32,}
struct Bounds{minX:i32,minY:i32,maxX:i32,maxY:i32,nearest:f32,rowAndClip:u32,pad0:u32,pad1:u32,triangles:u32,pad2:u32,pad3:u32,pad4:u32,}
@group(0) @binding(0) var<storage, read_write> pyramid:array<f32>;
@group(0) @binding(1) var level0:texture_2d<f32>;
@group(0) @binding(2) var<uniform> uni:Uni;
@group(0) @binding(3) var<storage, read> bounds:array<Bounds>;
@group(0) @binding(4) var<storage, read_write> flags:array<u32>;
@group(0) @binding(5) var<storage, read_write> state:array<atomic<u32>>;
@compute @workgroup_size(8, 8)
fn copyDepth(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.a||id.y>=uni.b){return;}
 let z=textureLoad(level0,vec2i(i32(id.x),i32(id.y)),0).r;
 pyramid[uni.c+id.y*uni.a+id.x]=z;
}
@compute @workgroup_size(8, 8)
fn reduceHiz(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.e||id.y>=uni.f){return;}
 let x0=id.x*2u;let y0=id.y*2u;
 // Profondeur inversee : le plus LOINTAIN d'un carre est le MINIMUM.
 var far=pyramid[uni.a+y0*uni.b+x0];
 if(x0+1u<uni.b){far=min(far,pyramid[uni.a+y0*uni.b+x0+1u]);}
 if(y0+1u<uni.c){
  far=min(far,pyramid[uni.a+(y0+1u)*uni.b+x0]);
  if(x0+1u<uni.b){far=min(far,pyramid[uni.a+(y0+1u)*uni.b+x0+1u]);}
 }
 pyramid[uni.d+id.y*uni.e+id.x]=far;
}
${HIZ_FAR_WGSL}
// Seules les boîtes que l'image teste voyagent jusqu'ici, chacune portant la ligne de verdict dont
// elle répond ; les lignes que l'image ne teste pas ont été remises à zéro avant cette passe. Le
// nombre de boîtes est celui que la partition a compacté : le processeur ne le connaît pas.
@compute @workgroup_size(64)
fn testHiz(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=atomicLoad(&state[${ST_TESTED}u])){return;}
 let b=bounds[i];
 let row=b.rowAndClip>>1u;
 // Une ligne testée que la pyramide ne peut pas juger reste dessinée : verdict 2, jamais 0 — 0
 // est la moitié occulteurs, et le raster de calcul la dessine dans son autre mode.
 if((b.rowAndClip&1u)!=0u||b.maxX<b.minX||b.maxY<b.minY){flags[row]=2u;return;}
 let far=pyramidFar(b.minX,b.minY,b.maxX,b.maxY,b.pad0,b.pad1);
 let bias=bitcast<f32>(uni.d);
 // Profondeur inversee : une boite est rejetee quand son point le PLUS PROCHE reste derriere le
 // plus lointain de la pyramide, donc quand il lui est INFERIEUR.
 let reject=select(0u,1u,b.nearest<far-bias);
 flags[row]=select(2u,1u,reject!=0u);
 if(reject!=0u){
  atomicAdd(&state[${ST_REJECTED}u],1u);
  atomicAdd(&state[${ST_REJECTED_TRIANGLES}u],b.triangles);
 }
}
`;
