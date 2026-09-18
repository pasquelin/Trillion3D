import { WRAP_MAP } from './visibilityWrapModes.ts';

/**
 * Le rang de tuile qu'un pixel transparent demande aux textures virtuelles, posé dans la seconde
 * cible de la passe de mélange. Une carte et un niveau par pixel, choisis par sa POSITION seule :
 * une tuile couvre des dizaines de pixels, donc chacune des six cartes et chacun des deux niveaux
 * du mélange est nommé par une part d'entre eux, et deux images complètes d'une même pose nomment
 * le même ensemble — ce que la convergence de la barrière attend d'elles. La dépendance à l'image
 * ne vit que dans le choix des pixels lus (la phase de la réduction), comme pour la passe opaque.
 * Une carte absente laisse parler la couleur de base. Le nuanceur hôte déclare `VSOut`, `wrapOf`
 * et les `*RequestIndex` avant ce bloc.
 */
export const BLEND_REQUEST_WGSL = `fn blendRequest(in:VSOut,wrap:u32,gradX:vec2f,gradY:vec2f)->u32{
 let px=u32(in.position.x)+u32(in.position.y);
 let sel=px%6u;
 let next=((px/6u)&1u)==1u;
 var slot=in.ids.x;var color=true;var map=${WRAP_MAP.base}u;
 if(sel==1u){slot=in.maps.x;color=false;map=${WRAP_MAP.rough}u;}
 else if(sel==2u){slot=in.maps.y;color=false;map=${WRAP_MAP.metal}u;}
 else if(sel==3u){slot=in.maps.z;color=false;map=${WRAP_MAP.normal}u;}
 else if(sel==4u){slot=in.maps.w;color=false;map=${WRAP_MAP.ao}u;}
 else if(sel==5u){slot=in.ids.z;map=${WRAP_MAP.emissive}u;}
 if(slot==0u){slot=in.ids.x;color=true;map=${WRAP_MAP.base}u;}
 if(slot==0u){return 0u;}
 if(color){return colorRequestIndex(slot,in.uv,wrapOf(wrap,map),gradX,gradY,next);}
 return dataRequestIndex(slot,in.uv,wrapOf(wrap,map),gradX,gradY,next);
}
`;
