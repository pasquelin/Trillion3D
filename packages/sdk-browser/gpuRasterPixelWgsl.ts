/**
 * Ce qu'un pixel du tampon de visibilité reçoit, et le départage de deux triangles qui tombent
 * exactement à la même profondeur.
 *
 * **Le départage.** WebGPU n'a pas d'atomique soixante-quatre bits : on ne peut pas écrire d'un seul
 * coup « cette profondeur ET cet identifiant ». Deux passes le font sans verrou et sans dépendre de
 * l'ordre des fils :
 *
 * 1. toutes les classes posent leur profondeur par `atomicMin` sur les bits IEEE-754 — pour une
 *    profondeur positive ces bits croissent avec la valeur, donc le minimum entier est le plus
 *    proche ;
 * 2. toutes les classes relisent la profondeur devenue définitive et, pour le seul triangle dont la
 *    profondeur est EXACTEMENT celle-là, posent leur identifiant par `atomicMin`.
 *
 * `min` est commutatif et associatif : le résultat ne dépend ni de l'ordre des fils, ni de l'ordre
 * des lancements, ni du découpage en classes. Et comme l'identifiant vaut `(ligne+1)<<8 | triangle`,
 * le minimum est le plus petit rang de ligne, puis le plus petit triangle : à profondeur égale, le
 * gagnant est toujours le même, d'une image à l'autre et d'une machine à l'autre. C'est le seul
 * endroit où l'image peut différer d'un raster matériel, qui départage, lui, par l'ordre de soumission.
 *
 * La couche coplanaire du cluster est un décalage entier sur la clé de profondeur, appliqué avant
 * l'empaquetage : retrancher des unités rapproche exactement d'autant de derniers bits. Zéro pour la
 * couche 0.
 */
export const RASTER_PIXEL_WGSL = `
/** Les poids barycentriques du pixel dans le sous-triangle qui le couvre ; \`w<0\` : aucun. */
fn coverAt(t:Tri,sample:vec2f)->vec4f{
 if(t.area0!=0.0){
  let bw=baryWeights(t.a,t.b,t.c,sample,t.area0);
  if(bw.x>=0.0&&bw.y>=0.0&&bw.z>=0.0){return vec4f(bw,0.0);}
 }
 if(t.quad!=0u&&t.area1!=0.0){
  let bw=baryWeights(t.a,t.c,t.d,sample,t.area1);
  if(bw.x>=0.0&&bw.y>=0.0&&bw.z>=0.0){return vec4f(bw,1.0);}
 }
 return vec4f(0.0,0.0,0.0,-1.0);
}
fn rasterPixel(t:Tri,pixel:vec2i,writeId:bool){
 let sample=vec2f(pixel)+vec2f(0.5);
 let cov=coverAt(t,sample);
 if(cov.w<0.0){return;}
 var qb=t.cb;var qc=t.cc;var nb=t.ub;var nc=t.uc;
 if(cov.w>0.5){qb=t.cc;qc=t.cd;nb=t.uc;nc=t.ud;}
 let wa=cov.x;let wb=cov.y;let wc=cov.z;
 let depth=wa*t.ca.z/t.ca.w+wb*qb.z/qb.w+wc*qc.z/qc.w;
 if(depth<0.0||depth>=1.0){return;}
 let page=pages[t.row];
 if((page.flags&128u)!=0u){
  let inv=wa/t.ca.w+wb/qb.w+wc/qc.w;
  let tc=(t.ua*(wa/t.ca.w)+nb*(wb/qb.w)+nc*(wc/qc.w))/inv;
  if(!maskKeep(page,tc)){return;}
 }
 let offset=u32(pixel.y)*u32(uni.viewport.x)+u32(pixel.x);
 let raw=bitcast<u32>(depth);
 let bits=select(raw,select(0u,raw-page.depthBias,raw>page.depthBias),page.depthBias>0u);
 if(writeId){if(atomicLoad(&work[offset])==bits){atomicMin(&work[pixelCount()+offset],page.packedBase|(t.triangle&0xffu));}}
 else{atomicMin(&work[offset],bits);}
}
`;
