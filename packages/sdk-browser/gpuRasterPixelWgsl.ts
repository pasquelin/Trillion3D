import { DEPTH_CLEAR, DEPTH_NEAR } from './depthConvention.ts';
import { wgslFloat } from './gpuPartitionMargins.ts';

/**
 * Ce qu'un pixel du tampon de visibilité reçoit, et le départage de deux triangles qui tombent
 * exactement à la même profondeur.
 *
 * **Le départage.** WebGPU n'a pas d'atomique soixante-quatre bits : on ne peut pas écrire d'un seul
 * coup « cette profondeur ET cet identifiant ». Deux passes le font sans verrou et sans dépendre de
 * l'ordre des fils :
 *
 * 1. toutes les classes posent leur profondeur par `atomicMax` sur les bits IEEE-754 — pour une
 *    profondeur positive ces bits croissent avec la valeur, et la profondeur du moteur est
 *    INVERSÉE (1 au plan proche, 0 à l'infini), donc le maximum entier est le plus proche ;
 * 2. toutes les classes relisent la profondeur devenue définitive et, pour le seul triangle dont la
 *    profondeur est EXACTEMENT celle-là, posent leur identifiant par `atomicMin`.
 *
 * `max` et `min` sont commutatifs et associatifs : le résultat ne dépend ni de l'ordre des fils, ni
 * de l'ordre des lancements, ni du découpage en classes. Et comme l'identifiant vaut
 * `(ligne+1)<<8 | triangle`, le minimum est le plus petit rang de ligne, puis le plus petit
 * triangle : à profondeur égale, le gagnant est toujours le même, d'une image à l'autre et d'une
 * machine à l'autre. C'est le seul endroit où l'image peut différer d'un raster matériel, qui
 * départage, lui, par l'ordre de soumission.
 *
 * La couche coplanaire du cluster est un décalage entier sur la clé de profondeur, appliqué avant
 * l'empaquetage : en profondeur inversée, AJOUTER des unités rapproche exactement d'autant de
 * derniers bits, plafonné aux bits du plan proche. Zéro pour la couche 0.
 *
 * **La couverture est étanche.** Un pixel est couvert quand ses trois fonctions d'arête ont le signe
 * de l'aire — jamais par des poids dérivés, dont la division et le \`1-w0-w1\` arrondissent assez
 * pour laisser un pixel d'arête partagée à personne, ou en accepter loin d'un éclat de coupe.
 * Chaque arête est évaluée dans l'ordre CANONIQUE de ses deux sommets, donc avec les mêmes opérandes
 * dans le même ordre pour les deux triangles qui la partagent : ils lisent la même valeur au signe
 * près, et un pixel exactement sur l'arête revient à celui des deux dont l'intérieur est du côté
 * positif du sens canonique — une règle haut-gauche, un seul propriétaire. Les mêmes trois valeurs
 * font les poids, normalisés sur leur somme : un poids qui ne somme pas à un décale toute la
 * profondeur d'une surface plate, assez pour perdre le départage d'une couche coplanaire.
 */
export const RASTER_PIXEL_WGSL = `
/** L'ordre canonique de deux sommets d'écran : le plus haut, puis le plus à gauche, en premier. */
fn canonBefore(a:vec2f,b:vec2f)->bool{return a.y<b.y||(a.y==b.y&&a.x<b.x);}
/** \`edge(a,b,p)\` calculé dans l'ordre canonique : les deux triangles d'une arête lisent les mêmes bits. */
fn canonEdge(a:vec2f,b:vec2f,p:vec2f,before:bool)->f32{
 if(before){return edge(a,b,p);}
 return -edge(b,a,p);
}
/** Vrai quand la valeur \`e\` de l'arête \`a→b\` laisse le pixel du côté intérieur d'un triangle d'aire \`area\`. */
fn edgeCovers(e:f32,before:bool,inside:bool)->bool{
 if(e==0.0){return before==inside;}
 return (e>0.0)==inside;
}
/** Les poids barycentriques du pixel dans le triangle \`(a,b,c)\` s'il le couvre ; \`w<0\` : non. */
fn coverTri(a:vec2f,b:vec2f,c:vec2f,area:f32,p:vec2f)->vec4f{
 let bc=canonBefore(b,c);let ca=canonBefore(c,a);let ab=canonBefore(a,b);
 let e0=canonEdge(b,c,p,bc);let e1=canonEdge(c,a,p,ca);let e2=canonEdge(a,b,p,ab);
 let inside=area>0.0;
 if(area==0.0||!edgeCovers(e0,bc,inside)||!edgeCovers(e1,ca,inside)||!edgeCovers(e2,ab,inside)){return vec4f(0.0,0.0,0.0,-1.0);}
 return vec4f(vec3f(e0,e1,e2)/(e0+e1+e2),1.0);
}
/** Les poids du pixel dans le sous-triangle qui le couvre, et lequel ; \`w<0\` : aucun. */
fn coverAt(t:Tri,sample:vec2f)->vec4f{
 let first=coverTri(t.a,t.b,t.c,t.area0,sample);
 if(first.w>=0.0){return vec4f(first.xyz,0.0);}
 if(t.quad!=0u){
  let second=coverTri(t.a,t.c,t.d,t.area1,sample);
  if(second.w>=0.0){return vec4f(second.xyz,1.0);}
 }
 return vec4f(0.0,0.0,0.0,-1.0);
}
fn rasterPixel(t:Tri,pixel:vec2i,writeId:bool){
 // La seule borne d'image de tout le raster : les pavés de fils dépassent la boîte du triangle dès
 // qu'elle n'en fait pas un compte rond, et la boîte est déjà serrée au dernier pixel de l'image.
 // Sans cette borne, un triangle au bord droit ou bas replie ses écritures sur la ligne suivante,
 // voire hors du plan des identifiants, où elles écrasent l'en-tête des listes de triangles.
 if(pixel.x>i32(t.hi.x)||pixel.y>i32(t.hi.y)){return;}
 let sample=vec2f(pixel)+vec2f(0.5);
 let cov=coverAt(t,sample);
 if(cov.w<0.0){return;}
 var qb=t.cb;var qc=t.cc;var nb=t.ub;var nc=t.uc;
 if(cov.w>0.5){qb=t.cc;qc=t.cd;nb=t.uc;nc=t.ud;}
 let wa=cov.x;let wb=cov.y;let wc=cov.z;
 let depth=wa*t.ca.z/t.ca.w+wb*qb.z/qb.w+wc*qc.z/qc.w;
 // Le plan lointain est infini : la profondeur descend vers le lointain sans jamais l'atteindre.
 if(depth<=${wgslFloat(DEPTH_CLEAR)}||depth>${wgslFloat(DEPTH_NEAR)}){return;}
 let page=pages[t.row];
 if((page.flags&128u)!=0u){
  let inv=wa/t.ca.w+wb/qb.w+wc/qc.w;
  let tc=(t.ua*(wa/t.ca.w)+nb*(wb/qb.w)+nc*(wc/qc.w))/inv;
  if(!maskKeep(page,tc,vec2f(0.0),vec2f(0.0),pixel,uni.maskFrame)){return;}
 }
 let offset=u32(pixel.y)*u32(uni.viewport.x)+u32(pixel.x);
 let raw=bitcast<u32>(depth);
 let bits=min(bitcast<u32>(${wgslFloat(DEPTH_NEAR)}),raw+page.depthBias);
 if(writeId){if(atomicLoad(&work[offset])==bits){atomicMin(&work[pixelCount()+offset],page.packedBase|(t.triangle&0xffu));}}
 else{atomicMax(&work[offset],bits);}
}
`;
