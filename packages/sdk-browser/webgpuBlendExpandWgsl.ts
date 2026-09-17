import { DRAW_UNPAGED } from './webgpuBlendPlan.ts';
import { EXPAND_GROUP, expandUniformWgsl, RUN_WORDS } from './webgpuBlendRuns.ts';

/**
 * L'ÉTALEMENT DU PLAN TRIÉ, SUR LA CARTE.
 *
 * Le processeur ne donne plus qu'une chose par image : l'ordre de peinture, ses tranches et le
 * verdict du tronc, un bit par item. Le reste — combien d'instances chaque entrée porte, où chacune
 * va dans la liste, et l'argument indirect de chaque tranche — est calculé ici, à partir des
 * comptes que la compaction transparente vient d'écrire dans la même soumission.
 *
 * Quatre lancements : un groupe de fils par paquet d'entrées, qui compte et scanne le paquet chez
 * lui ; la somme courante sur les paquets, à deux niveaux ; la place absolue de chaque entrée suivie
 * de l'écriture de ses instances ; puis l'argument de chaque tranche. Aucun fil ne recompte ce qu'un
 * autre vient de calculer. La
 * sémantique de référence est celle de `webgpuBlendExpandCpu.ts`, que suit le repli processeur, et
 * le banc `transparents-ordres.bench.mjs` compare les deux sorties mot pour mot.
 *
 * `scratch` porte la place de chaque entrée puis celle de chaque paquet, dans cet ordre. Les deux
 * passes — mélange puis transmission — s'enchaînent dans la même passe de calcul et se le repassent,
 * puisque leurs lancements sont ordonnés ; leurs instances et leurs arguments, eux, vivent dans deux
 * régions disjointes que l'uniforme désigne.
 */
export const BLEND_EXPAND_SHADER = `${expandUniformWgsl()}
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
var<workgroup> tuile:array<u32,${EXPAND_GROUP}>;
fn itemOf(i:u32)->u32{return plan[uni.orderBase+i]>>3u;}
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
/** La somme préfixe inclusive des soixante-quatre valeurs du paquet, en six étapes de doublement. */
fn scanTuile(k:u32){
 for(var pas=1u;pas<GROUP;pas=pas<<1u){
  var pris=0u;
  if(k>=pas){pris=tuile[k-pas];}
  workgroupBarrier();
  tuile[k]=tuile[k]+pris;
  workgroupBarrier();
 }
}
/** Un groupe de fils par paquet d'entrées : chacun compte SON entrée une fois, et le paquet en tire
 *  d'un coup la place de chacune chez lui et son total. */
@compute @workgroup_size(${EXPAND_GROUP})
fn countBlendGroups(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_id) lid:vec3u,@builtin(workgroup_id) wid:vec3u){
 let i=id.x;
 let k=lid.x;
 var mien=0u;
 if(i<uni.entryCount){mien=instancesOf(i);}
 tuile[k]=mien;
 workgroupBarrier();
 scanTuile(k);
 if(i<uni.entryCount){scratch[i]=tuile[k]-mien;}
 if(k==GROUP-1u){scratch[uni.entryCount+wid.x]=tuile[k];}
}
/** La somme courante sur les paquets, à deux niveaux : chaque fil en prend une tranche, le paquet
 *  scanne les soixante-quatre sous-totaux, puis chaque fil repose les siens. */
@compute @workgroup_size(${EXPAND_GROUP})
fn scanBlendGroups(@builtin(local_invocation_id) lid:vec3u){
 let k=lid.x;
 let par=(uni.groupCount+GROUP-1u)/GROUP;
 let debut=min(k*par,uni.groupCount);
 let fin=min(debut+par,uni.groupCount);
 var somme=0u;
 for(var g=debut;g<fin;g++){somme=somme+scratch[uni.entryCount+g];}
 tuile[k]=somme;
 workgroupBarrier();
 scanTuile(k);
 var curseur=uni.instanceBase+tuile[k]-somme;
 for(var g=debut;g<fin;g++){
  let tenu=scratch[uni.entryCount+g];
  scratch[uni.entryCount+g]=curseur;
  curseur=curseur+tenu;
 }
}
/** La place absolue de chaque entrée, puis ses instances : la place chez soi est déjà comptée. */
@compute @workgroup_size(${EXPAND_GROUP})
fn placeBlendEntries(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;
 if(i>=uni.entryCount){return;}
 let at=scratch[uni.entryCount+i/GROUP]+scratch[i];
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
@compute @workgroup_size(${EXPAND_GROUP})
fn writeBlendRuns(@builtin(global_invocation_id) id:vec3u){
 let r=id.x;
 if(r>=uni.runCount){return;}
 let at=uni.runsBase+r*${RUN_WORDS}u;
 let first=plan[at];
 let entries=plan[at+1u];
 let last=first+entries-1u;
 let base=scratch[first];
 // La tranche qui fusionne dessine des grappes, au pas de la table ; celle qui n'a gardé qu'une
 // entree dessine ce que SON item porte. Le propriétaire se lit sur l'entrée, comme au processeur.
 let entry=plan[uni.orderBase+first];
 let fusionne=entries>1u&&(entry&4u)!=0u;
 var vertexCount=uni.maxVertexWords;
 if(!fusionne&&draws[entry>>3u].x==${DRAW_UNPAGED}u){vertexCount=draws[entry>>3u].w;}
 let o=uni.argsBase+r*4u;
 args[o]=vertexCount;
 args[o+1u]=scratch[last]+instancesOf(last)-base;
 args[o+2u]=base<<uni.vertexShift;
 args[o+3u]=0u;
}
`;
