/**
 * Le rang de tuile qu'un pixel transparent demande aux textures virtuelles, posé dans la seconde
 * cible de la passe de mélange, celle que la résolution opaque a ouverte. La règle — phase, choix
 * de la carte par la position, repli sur la base — est celle de `TILE_REQUEST_WGSL`, la même que
 * l'opaque ; seule la source des slots est celle de l'item. Le nuanceur hôte déclare `VSOut`,
 * `uni.feedback` et insère `TILE_REQUEST_WGSL` avant ce bloc.
 */
export const BLEND_REQUEST_WGSL = `fn blendRequest(in:VSOut,wrap:u32,gradX:vec2f,gradY:vec2f)->u32{
 if(!feedbackPhase(in.position.xy,uni.feedback)){return 0u;}
 let p=requestPick(in.position.xy,MAP_CHOICES);
 return mapRequest(p.sel,vec2u(in.ids.x,in.ids.z),in.maps,in.uv,wrap,gradX,gradY,p.next);
}
`;
