/**
 * Le tronc des items transparents, teste par la carte.
 *
 * Un fil par item. Il lit la boite monde de l'item, la confronte aux six plans du tronc, puis ecrit
 * l'argument indirect de son appel : le compte d'instances que la compaction vient de calculer, ou
 * zero si le tronc rejette l'item. Le processeur ne parcourt plus aucun item par image.
 *
 * Le verdict est CONSERVATEUR par construction. La boite arrive deja elargie vers l'exterieur a
 * l'arrondi simple precision (`webgpuBlendPlan.ts`), et chaque plan se donne encore une marge
 * proportionnelle a la taille de la boite et a la distance du plan : une boite que la reference
 * double precision gardait ne peut pas etre rejetee ici. Un transparent ne devient donc jamais
 * masque ; au pire un item hors champ paie un appel qui ne pose aucun pixel.
 *
 * Comme la reference, une comparaison avec NaN ne rejette jamais.
 */
export const BLEND_SELECT_SHADER = `struct Uni{planes:array<vec4f,6>,itemCount:u32,pad0:u32,pad1:u32,pad2:u32,}
@group(0) @binding(0) var<uniform> uni:Uni;
@group(0) @binding(1) var<storage,read> boxes:array<vec4f>;
@group(0) @binding(2) var<storage,read> draws:array<vec4u>;
@group(0) @binding(3) var<storage,read> counts:array<u32>;
@group(0) @binding(4) var<storage,read_write> args:array<u32>;
@compute @workgroup_size(64)
fn selectBlendItems(@builtin(global_invocation_id) gid:vec3u){
 let item=gid.x;
 if(item>=uni.itemCount){return;}
 let lo=boxes[item*2u];
 let hi=boxes[item*2u+1u];
 var rejected=false;
 // Sans boite exploitable, l'item n'est jamais rejete : c'est la regle du chemin processeur.
 if(lo.w!=0.0){
  let span=max(max(abs(lo.x),abs(lo.y)),max(abs(lo.z),max(abs(hi.x),max(abs(hi.y),abs(hi.z)))));
  for(var p=0u;p<6u;p++){
   let pl=uni.planes[p];
   let x=select(lo.x,hi.x,pl.x>0.0);
   let y=select(lo.y,hi.y,pl.y>0.0);
   let z=select(lo.z,hi.z,pl.z>0.0);
   if(pl.x*x+pl.y*y+pl.z*z+pl.w < -(1e-5*(abs(pl.w)+span+1.0))){rejected=true;break;}
  }
 }
 let d=draws[item];
 // Un item pagine tire son compte d'instances de la compaction ; un item non pagine en dessine une.
 var instances=select(1u,counts[d.x*4u+1u],d.x!=0xffffffffu);
 if(rejected){instances=0u;}
 let o=item*4u;
 args[o]=d.y;
 args[o+1u]=instances;
 args[o+2u]=d.z;
 args[o+3u]=0u;
}
`;
