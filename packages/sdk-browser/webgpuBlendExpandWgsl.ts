import { DRAW_UNPAGED } from './webgpuBlendPlan.ts';
import { EXPAND_GROUP, RUN_SHARED } from './webgpuBlendRuns.ts';

/**
 * L'ÉTALEMENT DU PLAN TRIÉ, SUR LA CARTE.
 *
 * Le processeur ne donne plus qu'une chose par image : l'ordre de peinture, ses tranches et le
 * verdict du tronc, un bit par item. Le reste — combien d'instances chaque entrée porte, où chacune
 * va dans la liste, et l'argument indirect de chaque tranche — est calculé ici, à partir des
 * comptes que la compaction transparente vient d'écrire dans la même soumission.
 *
 * Quatre lancements : un compte par paquet d'entrées, une somme courante sur les paquets, la place
 * de chaque entrée suivie de l'écriture de ses instances, puis l'argument de chaque tranche. La
 * sémantique de référence est celle de `webgpuBlendExpandCpu.ts`, que suit le repli processeur, et
 * le banc `transparents-ordres.bench.mjs` compare les deux sorties mot pour mot.
 *
 * `scratch` porte la place de chaque entrée puis celle de chaque paquet, dans cet ordre. Les deux
 * passes — mélange puis transmission — s'enchaînent dans la même passe de calcul et se le repassent,
 * puisque leurs lancements sont ordonnés ; leurs instances et leurs arguments, eux, vivent dans deux
 * régions disjointes que l'uniforme désigne.
 */
export const BLEND_EXPAND_SHADER = `struct Uni{entryCount:u32,groupCount:u32,runCount:u32,instanceBase:u32,argsBase:u32,maxVertexWords:u32,vertexShift:u32,orderBase:u32,runsBase:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(0) @binding(0) var<uniform> uni:Uni;
@group(0) @binding(1) var<storage,read> plan:array<u32>;
@group(0) @binding(2) var<storage,read> keep:array<u32>;
@group(0) @binding(3) var<storage,read> draws:array<vec4u>;
@group(0) @binding(4) var<storage,read> counts:array<u32>;
@group(0) @binding(5) var<storage,read> clusters:array<u32>;
@group(0) @binding(6) var<storage,read_write> scratch:array<u32>;
@group(0) @binding(7) var<storage,read_write> expanded:array<vec2u>;
@group(0) @binding(8) var<storage,read_write> args:array<u32>;
const GROUP=${EXPAND_GROUP}u;
fn itemOf(i:u32)->u32{return plan[uni.orderBase+i]>>2u;}
fn kept(item:u32)->bool{return (keep[item>>5u]&(1u<<(item&31u)))!=0u;}
/** Ce qu'une entrée de plan étale : les grappes que la compaction lui a gardées, les morceaux
 *  qu'une primitive non paginée porte, rien du tout si le tronc a rejeté son item. */
fn instancesOf(i:u32)->u32{
 let item=itemOf(i);
 if(!kept(item)){return 0u;}
 let d=draws[item];
 if(d.x==${DRAW_UNPAGED}u){return d.y;}
 return counts[d.x*4u+1u];
}
@compute @workgroup_size(64)
fn countBlendGroups(@builtin(global_invocation_id) id:vec3u){
 let g=id.x;
 if(g>=uni.groupCount){return;}
 let end=min(g*GROUP+GROUP,uni.entryCount);
 var total=0u;
 for(var i=g*GROUP;i<end;i++){total=total+instancesOf(i);}
 scratch[uni.entryCount+g]=total;
}
@compute @workgroup_size(1)
fn scanBlendGroups(){
 var cursor=uni.instanceBase;
 for(var g=0u;g<uni.groupCount;g++){
  let held=scratch[uni.entryCount+g];
  scratch[uni.entryCount+g]=cursor;
  cursor=cursor+held;
 }
}
@compute @workgroup_size(64)
fn placeBlendEntries(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=uni.entryCount){return;}
 let g=i/GROUP;
 var at=scratch[uni.entryCount+g];
 for(var j=g*GROUP;j<i;j++){at=at+instancesOf(j);}
 scratch[i]=at;
 let held=instancesOf(i);
 if(held==0u){return;}
 let item=itemOf(i);
 let d=draws[item];
 if(d.x==${DRAW_UNPAGED}u){
  for(var j=0u;j<held;j++){expanded[at+j]=vec2u(item,j*d.w);}
  return;
 }
 for(var j=0u;j<held;j++){expanded[at+j]=vec2u(item,clusters[d.z+j]);}
}
@compute @workgroup_size(64)
fn writeBlendRuns(@builtin(global_invocation_id) id:vec3u){
 let r=id.x;
 if(r>=uni.runCount){return;}
 let at=uni.runsBase+r*4u;
 let first=plan[at];
 let last=first+plan[at+1u]-1u;
 let base=scratch[first];
 let owner=plan[at+3u];
 var vertexCount=uni.maxVertexWords;
 if(owner!=${RUN_SHARED}u&&draws[owner].x==${DRAW_UNPAGED}u){vertexCount=draws[owner].w;}
 let o=uni.argsBase+r*4u;
 args[o]=vertexCount;
 args[o+1u]=scratch[last]+instancesOf(last)-base;
 args[o+2u]=base<<uni.vertexShift;
 args[o+3u]=0u;
}
`;
