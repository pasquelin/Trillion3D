/**
 * Le retour d'image des textures virtuelles : ce qu'un pixel DEMANDE, tuile par tuile. Deux formes
 * du même calcul — le rang de la tuile, pour une passe qui le pose dans une cible ; le compteur
 * atomique, pour une passe qui peut écrire en mémoire. Le niveau et l'adresse sont ceux de la
 * lecture (`slotLod`, `${k}Entry`) : ce qu'un pixel demande est ce qu'il lit. Exige `TILE_POOL_WGSL`
 * et les lectures de l'atlas (`COLOR_SAMPLE_WGSL`, `DATA_SAMPLE_WGSL`) avant ce bloc.
 */
const request = (k: string) => `fn ${k}RequestAt(s:TileSlot,uv:vec2f,level:u32)->u32{
 if(level>=s.tail){return 0u;}
 return ${k}Entry(s,uv,level)-${k}Pages[2]+${k}Pages[0]+1u;
}
fn ${k}RequestIndex(slot:u32,uv:vec2f,wrap:u32,ddx:vec2f,ddy:vec2f,next:bool)->u32{
 let s=${k}Slot(slot);
 if(s.tail==0u){return 0u;}
 let lod=slotLod(s,ddx,ddy);
 let level=u32(floor(lod))+select(0u,1u,next&&lod-floor(lod)>0.0);
 return ${k}RequestAt(s,slotWrapped(s,uv,wrap),level);
}`;

/** Le retour par compteur atomique : les deux niveaux qu'un pixel mêle, comptés d'un coup.
 *  `${k}FeedbackAt` prend l'en-tête et la coordonnée déjà ramenée : ce qu'une passe qui demande
 *  plusieurs empreintes d'une même carte calcule une fois. */
const feedback = (k: string) => `fn ${k}FeedbackAt(s:TileSlot,w:vec2f,ddx:vec2f,ddy:vec2f){
 let lod=slotLod(s,ddx,ddy);
 let l0=u32(floor(lod));
 let first=${k}RequestAt(s,w,l0);
 if(first==0u){return;}
 atomicAdd(&tileFeedback[first-1u],1u);
 if(lod-floor(lod)<=0.0){return;}
 let second=${k}RequestAt(s,w,l0+1u);
 if(second!=0u&&second!=first){atomicAdd(&tileFeedback[second-1u],1u);}
}
fn ${k}Feedback(slot:u32,uv:vec2f,wrap:u32,ddx:vec2f,ddy:vec2f){
 let s=${k}Slot(slot);
 if(s.tail==0u){return;}
 ${k}FeedbackAt(s,slotWrapped(s,uv,wrap),ddx,ddy);
}`;

/** Le rang de tuile qu'un pixel demande, plus un, ou zéro : `colorRequestIndex(slot, uv, wrap,
 *  ddx, ddy, next)` et `dataRequestIndex(...)`. `next` choisit le second niveau du mélange. C'est ce
 *  qu'une passe qui ne peut pas écrire en mémoire — le mélange, qui tient à son rejet anticipé —
 *  pose dans sa cible de retour, réduite ensuite en compteurs. */
export const TILE_REQUEST_WGSL = `${request('color')}
${request('data')}`;

/** Retour d'image par compteurs atomiques des deux atlas : `colorFeedback(...)`, `dataFeedback(...)`.
 *  Il nomme `tileFeedback` : seules les passes qui publient un retour l'insèrent. */
export const TILE_FEEDBACK_WGSL = `${TILE_REQUEST_WGSL}
${feedback('color')}
${feedback('data')}`;
