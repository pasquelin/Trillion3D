import { PAGE_INFO_STRUCT_WGSL } from './visibilityPageWgsl.ts';
import { BASE_SLOTS } from './gpuDrawContract.ts';

/** Les fils d'un groupe de travail de la marque : une tuile d'instances de la moitié testée. */
export const REST_COMPACT_WORKGROUP = 64;

/**
 * La troncature de la moitié testée, entre le test d'occultation et la seconde passe de géométrie.
 *
 * Une ligne dont la grappe a été rejetée par la pyramide était dessinée quand même : sa commande
 * indirecte a compté ses instances avant que le verdict n'existe, et l'étage de sommets écartait
 * ensuite chacun de ses sommets un par un. Le dessin ne posait aucun pixel, mais l'appareil lançait
 * tout de même, pour chacune de ces instances, le nombre de sommets de la plus grosse page du
 * modèle.
 *
 * Ce noyau cherche le RANG DE LA DERNIÈRE SURVIVANTE de chaque slot testé — la négation exacte du
 * prédicat de rejet de l'étage de sommets, `hizSlot` valide et verdict 1 — et ramène le compte
 * d'instances de la commande à ce rang. Le verdict est à trois valeurs depuis 12aa9fcd (0 occulteur,
 * 1 rejeté, 2 testé et gardé) : lire « nul » ici tronquait toute la moitié testée, et le raster
 * matériel perdait chaque grappe qui sortait de derrière une autre. Ce qui sort du compte est un suffixe d'instances toutes rejetées, qui ne
 * dessinaient rien : l'image est identique par construction, et l'ORDRE des instances retenues ne
 * bouge pas d'un rang, puisque rien n'est déplacé.
 *
 * Il n'y a pas de compaction des trous au milieu : une compaction stable demande un préfixe, donc
 * une barrière de groupe de travail sous une boucle bornée par le compte d'instances — que WGSL
 * refuse, ce compte étant lu dans un tampon de stockage (« must only be called from uniform control
 * flow »). Le maximum atomique, lui, ne demande aucune barrière.
 */
export const REST_COMPACT_SHADER = `${PAGE_INFO_STRUCT_WGSL}
struct Uniforms{restSlots:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(0) @binding(0) var<storage, read> instances:array<u32>;
@group(0) @binding(1) var<storage, read_write> indirect:array<u32>;
@group(0) @binding(2) var<storage, read> slotOffsets:array<u32>;
@group(0) @binding(3) var<storage, read> pages:array<PageInfo>;
@group(0) @binding(4) var<storage, read> hizFlags:array<u32>;
@group(0) @binding(5) var<storage, read_write> dernieres:array<atomic<u32>>;
@group(0) @binding(6) var<uniform> uni:Uniforms;
/** Le rang du slot testé numéro \`n\` : trois modes de face par couche, après les trois occulteurs. */
fn restSlotAt(n:u32)->u32{return (n/${BASE_SLOTS / 2}u)*${BASE_SLOTS}u+${BASE_SLOTS / 2}u+n%${BASE_SLOTS / 2}u;}
/** La négation du prédicat de l'étage de sommets : seule une ligne rejetée (verdict 1) n'écrit rien. */
fn vivante(ligne:u32)->bool{
 let hizSlot=pages[ligne].hizSlot;
 return hizSlot==0xffffffffu||hizFlags[hizSlot]!=1u;
}
@compute @workgroup_size(${REST_COMPACT_WORKGROUP})
fn restMark(@builtin(global_invocation_id) id:vec3u){
 if(id.y>=uni.restSlots){return;}
 let slot=restSlotAt(id.y);
 let count=indirect[slot*4u+1u];
 if(id.x>=count){return;}
 if(vivante(instances[slotOffsets[slot]+id.x])){atomicMax(&dernieres[id.y],id.x+1u);}
}
@compute @workgroup_size(${REST_COMPACT_WORKGROUP})
fn restApply(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.restSlots){return;}
 indirect[restSlotAt(id.x)*4u+1u]=atomicLoad(&dernieres[id.x]);
}
`;
