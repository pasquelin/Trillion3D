import { HIZ_KERNEL_TEXELS } from './hizCounts.ts';

/**
 * Le choix du mip qui répond pour un rectangle d'écran DÉJÀ découpé au viewport : miroir GPU de
 * `premierNiveau` puis de la recherche que `hizTestRect` faisait boîte par boîte sur le processeur.
 *
 * Ce bout de code n'est écrit qu'une fois parce que deux noyaux en dépendent — l'empaquetage des
 * bornes de la moitié testée opaque et le test d'occultation des grappes transparentes —, et que
 * deux écritures de la même règle finiraient par différer. Aucun des deux ne lit la pyramide ici :
 * seul le niveau et son existence sortent, et un rectangle qu'aucun mip ne couvre n'est jamais
 * rejeté.
 */
export const HIZ_LEVEL_WGSL = `
/** Miroir de \`premierNiveau\` (hizOcclusion.ts) : plus bas mip qui puisse tenir dans le noyau. */
fn firstLevel(span:i32)->u32{
 if(span<${HIZ_KERNEL_TEXELS}){return 0u;}
 let level=31u-countLeadingZeros(u32(span))-${Math.log2(HIZ_KERNEL_TEXELS) - 1}u;
 return select(level,0u,level>31u);
}
/** Le mip qui couvre le rectangle en moins de seize texels, et s'il en existe un : \`(niveau, 1)\`,
 *  ou \`(0, 0)\` quand la pyramide n'en porte aucun d'assez grossier. */
fn hizLevelFor(rect:vec4i,levels:u32)->vec2u{
 var l=firstLevel(max(rect.z-rect.x,rect.w-rect.y));
 loop{
  if(l>=levels){break;}
  if((rect.z>>l)-(rect.x>>l)<${HIZ_KERNEL_TEXELS}&&(rect.w>>l)-(rect.y>>l)<${HIZ_KERNEL_TEXELS}){
   return vec2u(l,1u);
  }
  l++;
 }
 return vec2u(0u,0u);
}
`;

/** La profondeur la plus LOINTAINE de l'empreinte d'une boîte dans un mip de la pyramide. Un
 *  rectangle vide ou plus large que le noyau rend 1, la valeur qui ne rejette jamais. Le noyau
 *  hôte déclare `pyramid`, le seul tampon que cette fonction lit. */
export const HIZ_FAR_WGSL = `
fn pyramidFar(minX:i32,minY:i32,maxX:i32,maxY:i32,offset:u32,width:u32)->f32{
 let x0=minX;let y0=minY;let x1=maxX+1;let y1=maxY+1;
 if(x1<=x0||y1<=y0){return 1.0;}
 if(x1-x0>${HIZ_KERNEL_TEXELS}||y1-y0>${HIZ_KERNEL_TEXELS}){return 1.0;}
 var far=-1.0e30;var hit=false;
 for(var y=y0;y<y1;y++){
  for(var x=x0;x<x1;x++){
   far=max(far,pyramid[offset+u32(y)*width+u32(x)]);
   hit=true;
  }
 }
 if(!hit){return 1.0;}
 return far;
}
`;
