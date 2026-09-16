import {
  CNT_COARSE,
  CNT_FINE,
  CNT_HUGE,
  CNT_LARGE,
  DISPATCH_BASE,
  DISPATCH_SPAN,
  FINE_PER_GROUP,
  FINE_SIDE,
  LIST_HEADER,
  MODE_DEPTH_OCCLUDER,
  MODE_DEPTH_REST,
  RASTER_CLASSES,
  TILE,
  TILE_ROWS,
  rasterEntry,
} from './gpuRasterContract.ts';
import { DEPTH_CLEAR } from './depthConvention.ts';
import { wgslFloat } from './gpuPartitionMargins.ts';

/** Les douze points d'entrée : quatre classes de taille, chacune dans les trois modes de l'image. */
const entryPoints = () =>
  RASTER_CLASSES.flatMap((klass, index) =>
    [0, 1, 2].map(
      (mode) =>
        `@compute @workgroup_size(${TILE},${TILE}) fn ${rasterEntry(klass, mode)}(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_id) l:vec3u){${['fineGroup', 'coarseGroup', 'largeGroup', 'hugeGroup'][index]}(g,l,${mode}u);}`,
    ),
  ).join('\n');

/**
 * Les noyaux du raster de calcul : la remise à zéro de l'image, le rangement des triangles par
 * classe, la traduction des comptes en lancements, et les quatre classes elles-mêmes.
 *
 * **Les trois modes et le test d'occultation.** Le partage occulteurs/testés que la partition décide
 * ne voyage pas par un tampon de plus — la carte n'en a plus de libre à l'étage de calcul. Il voyage
 * par le mot de verdict que chaque ligne possède déjà : la partition y écrit `0` pour la moitié
 * occulteurs et `2` pour la moitié testée, et le test Hi-Z ramène ce `2` à `1` sur les lignes qu'il
 * rejette. Le mode `0` pose donc la profondeur des occulteurs — c'est elle que la pyramide réduit —,
 * le mode `1` ajoute la moitié testée survivante, et le mode `2` départage les identifiants sur tout
 * ce qui a été dessiné. Sans partition ni pyramide, tous les mots valent zéro : le mode `0` dessine
 * toute la coupe et les deux autres n'ajoutent rien, ce qui est exactement l'image d'une seule passe.
 *
 * Le rangement, lui, ne connaît pas les verdicts : il tourne avant la pyramide, donc avant que le
 * test de CETTE image n'ait rien décidé. Il range tout ce que la coupe porte, et ce sont les passes
 * de raster qui écartent les lignes rejetées. Une ligne rejetée coûte son rangement, pas ses pixels.
 */
export const rasterKernels = (capacity: number) => `
const LIST_S:u32=LIST+${LIST_HEADER}u;
const LIST_L:u32=LIST+${LIST_HEADER + capacity}u;
@compute @workgroup_size(64) fn clear(@builtin(global_invocation_id) gid:vec3u){
 let offset=gid.x;let pixels=pixelCount();if(offset>=pixels){return;}
 // Profondeur inversée : le tampon part du LOINTAIN, et c'est le PLUS GRAND qui gagne ensuite.
 atomicStore(&work[offset],bitcast<u32>(${wgslFloat(DEPTH_CLEAR)}));atomicStore(&work[pixels+offset],0xffffffffu);
}
/** Le verdict d'une ligne : 0 occulteur, 1 testée et rejetée, 2 testée et gardée. */
fn rowVerdict(page:PageInfo)->u32{
 if(page.hizSlot==0xffffffffu){return 0u;}
 return hizFlags[page.hizSlot];
}
fn modeKeeps(mode:u32,verdict:u32)->bool{
 if(mode==${MODE_DEPTH_OCCLUDER}u){return verdict==0u;}
 if(mode==${MODE_DEPTH_REST}u){return verdict==2u;}
 return verdict!=1u;
}
/** Une entrée de liste redevient le triangle qu'elle nomme, si le mode courant le dessine. */
fn triOf(entry:u32,mode:u32)->Tri{
 var t:Tri;t.ok=0u;
 let row=entry>>8u;let page=pages[row];
 if(!modeKeeps(mode,rowVerdict(page))){return t;}
 return setupTriangle(row,entry&0xffu,pageTransform(page),pageWinding(page));
}
// Une dimension de lancement plafonne à 65 535 groupes, bien en deçà du nombre de pages qu'une scène
// répliquée atteint : la ligne de page se répartit sur y et z, bornée par le nombre de lignes vives.
fn pageRow(group:vec3u)->u32{return group.y+group.z*${DISPATCH_SPAN}u;}
// Les 64 fils d'un groupe de tri partagent la même page : le fil zéro calcule pour eux les deux
// quantités qui n'appartiennent qu'à la page, et les 63 autres les relisent au lieu de les refaire.
var<workgroup> rowVp:mat4x4f;
var<workgroup> rowDet:f32;
// Un fil par triangle des lignes dessinables. Les survivants sont rangés dans la liste de leur
// classe, dont l'image ne peut pas voir l'ordre : les passes résolvent leurs pixels par un minimum.
@compute @workgroup_size(64) fn bin(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_id) lane:vec3u){
 let row=pageRow(group);
 let live=row<uni.pageCount;
 if(live&&lane.x==0u){let page=pages[row];rowVp=pageTransform(page);rowDet=pageWinding(page);}
 workgroupBarrier();
 if(!live){return;}
 let triangle=group.x*64u+lane.x;
 let t=setupTriangle(row,triangle,rowVp,rowDet);
 if(t.ok==0u){return;}
 let entry=(row<<8u)|(triangle&0xffu);
 let klass=triClass(t);
 // Deux classes par liste, remplies par les deux bouts : aucune ne déborde pendant que l'autre a de
 // la place, et la borne tenue est la somme — tout triangle de toute ligne.
 if(klass==0u){atomicStore(&work[LIST_S+atomicAdd(&work[LIST+${CNT_FINE}u],1u)],entry);}
 else if(klass==1u){atomicStore(&work[LIST_S+${capacity}u-1u-atomicAdd(&work[LIST+${CNT_COARSE}u],1u)],entry);}
 else if(klass==2u){atomicStore(&work[LIST_L+atomicAdd(&work[LIST+${CNT_LARGE}u],1u)],entry);}
 else{
  atomicStore(&work[LIST_L+${capacity}u-1u-atomicAdd(&work[LIST+${CNT_HUGE}u],1u)],entry);
  // La plus haute boîte de l'image donne la dimension y du lancement de la classe démesurée : un
  // groupe par pavé de huit lignes, et ceux qui dépassent la boîte de leur triangle sortent aussitôt.
  atomicMax(&work[LIST+${TILE_ROWS}u],tileRows(t));
 }
}
/** Les deux dimensions d'un lancement d'une liste : x plafonne, y prend le débordement. */
fn spread(slot:u32,groups:u32){
 let base=LIST+${DISPATCH_BASE}u+slot*3u;
 atomicStore(&work[base],min(groups,${DISPATCH_SPAN}u));
 atomicStore(&work[base+1u],(groups+${DISPATCH_SPAN}u-1u)/${DISPATCH_SPAN}u);
 atomicStore(&work[base+2u],1u);
}
/** Chaque compte devient son lancement, sans qu'aucun ne passe par le processeur. */
@compute @workgroup_size(1) fn plan(){
 let fine=(atomicLoad(&work[LIST+${CNT_FINE}u])+${FINE_PER_GROUP}u-1u)/${FINE_PER_GROUP}u;
 spread(0u,fine);
 spread(1u,atomicLoad(&work[LIST+${CNT_COARSE}u]));
 spread(2u,atomicLoad(&work[LIST+${CNT_LARGE}u]));
 let huge=atomicLoad(&work[LIST+${CNT_HUGE}u]);
 atomicStore(&work[LIST+${DISPATCH_BASE + 9}u],min(huge,${DISPATCH_SPAN}u));
 atomicStore(&work[LIST+${DISPATCH_BASE + 10}u],max(1u,atomicLoad(&work[LIST+${TILE_ROWS}u])));
 atomicStore(&work[LIST+${DISPATCH_BASE + 11}u],(huge+${DISPATCH_SPAN}u-1u)/${DISPATCH_SPAN}u);
}
fn listAt(group:vec3u)->u32{return group.x+group.y*${DISPATCH_SPAN}u;}
// Un groupe au-delà du compte de sa classe ne lit rien d'utile, mais il lit : son rang est serré sur
// la liste pour que cette lecture reste dans le tampon. Son triangle est écarté juste après.
fn held(i:u32)->u32{return min(i,${capacity - 1}u);}
// Un groupe fait toujours soixante-quatre fils, quelle que soit la classe : la moyenne les dépense
// sur le pavé de huit par huit d'un seul triangle, la fine sur ${FINE_PER_GROUP} triangles de
// ${FINE_SIDE}×${FINE_SIDE} pixels chacun. Un triangle est préparé une fois pour les fils qui le
// partagent, qui relisent ensuite ce qu'une préparation par fil aurait produit.
var<workgroup> shared_tri:array<Tri,${FINE_PER_GROUP}u>;
fn fineGroup(group:vec3u,lane:vec3u,mode:u32){
 let index=lane.y*${TILE}u+lane.x;
 let slot=index/${FINE_SIDE * FINE_SIDE}u;
 let i=listAt(group)*${FINE_PER_GROUP}u+slot;
 if(index%${FINE_SIDE * FINE_SIDE}u==0u){
  var t:Tri;t.ok=0u;
  if(i<atomicLoad(&work[LIST+${CNT_FINE}u])){t=triOf(atomicLoad(&work[LIST_S+i]),mode);}
  shared_tri[slot]=t;
 }
 workgroupBarrier();
 let t=shared_tri[slot];
 if(t.ok==0u){return;}
 let pixel=index%${FINE_SIDE * FINE_SIDE}u;
 rasterPixel(t,vec2i(t.lo)+vec2i(i32(pixel%${FINE_SIDE}u),i32(pixel/${FINE_SIDE}u)),mode==2u);
}
/** Le triangle que ce groupe rastère, préparé par un seul fil et relu par les soixante-quatre. */
fn oneTri(entry:u32,valid:bool,lane:vec3u,mode:u32)->Tri{
 if(lane.x==0u&&lane.y==0u){
  var t:Tri;t.ok=0u;
  if(valid){t=triOf(entry,mode);}
  shared_tri[0]=t;
 }
 workgroupBarrier();
 return shared_tri[0];
}
fn coarseGroup(group:vec3u,lane:vec3u,mode:u32){
 let i=listAt(group);
 let live=i<atomicLoad(&work[LIST+${CNT_COARSE}u]);
 let t=oneTri(select(0u,atomicLoad(&work[LIST_S+${capacity}u-1u-held(i)]),live),live,lane,mode);
 if(t.ok==0u){return;}
 rasterPixel(t,vec2i(t.lo)+vec2i(lane.xy),mode==2u);
}
// Le pixel du pavé (tx,ty) d'une boîte : rasterPixel écarte ceux qui sortent de l'image.
fn tilePixel(t:Tri,lane:vec3u,tx:u32,ty:u32)->vec2i{
 return vec2i(t.lo)+vec2i(i32(tx*${TILE}u+lane.x),i32(ty*${TILE}u+lane.y));
}
fn largeGroup(group:vec3u,lane:vec3u,mode:u32){
 let i=listAt(group);
 let live=i<atomicLoad(&work[LIST+${CNT_LARGE}u]);
 let t=oneTri(select(0u,atomicLoad(&work[LIST_L+held(i)]),live),live,lane,mode);
 if(t.ok==0u){return;}
 let cols=tileCols(t);let rows=tileRows(t);
 for(var ty=0u;ty<rows;ty=ty+1u){
  for(var tx=0u;tx<cols;tx=tx+1u){
   rasterPixel(t,tilePixel(t,lane,tx,ty),mode==2u);
  }
 }
}
// La classe démesurée ne boucle plus sur ses lignes de pavés : chacune est un groupe de plus, pris
// sur la dimension y du lancement. Un groupe dont la ligne dépasse la boîte de son triangle sort.
fn hugeGroup(group:vec3u,lane:vec3u,mode:u32){
 let i=group.x+group.z*${DISPATCH_SPAN}u;
 let live=i<atomicLoad(&work[LIST+${CNT_HUGE}u]);
 let t=oneTri(select(0u,atomicLoad(&work[LIST_L+${capacity}u-1u-held(i)]),live),live,lane,mode);
 if(t.ok==0u||group.y>=tileRows(t)){return;}
 let cols=tileCols(t);
 for(var tx=0u;tx<cols;tx=tx+1u){
  rasterPixel(t,tilePixel(t,lane,tx,group.y),mode==2u);
 }
}
${entryPoints()}
`;
