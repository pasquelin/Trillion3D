import { FLAG_SAMPLED } from '../../visibility/types.ts';

/**
 * Tile rank a transparent pixel requests from the virtual textures, stored in the second
 * target of the blend pass, the one the opaque resolve opened. The rule — phase, map chosen
 * by position, fallback to the base — is `TILE_REQUEST_WGSL`, the same as the opaque path;
 * only the slot source is the item's. The host shader declares `VSOut`, `uni.feedback` and
 * inserts `TILE_REQUEST_WGSL` before this block.
 */
export const BLEND_REQUEST_WGSL = `fn blendRequest(in:VSOut,gradX:vec2f,gradY:vec2f)->u32{
 if(!feedbackPhase(in.position.xy,uni.feedback)){return 0u;}
 let p=requestPick(in.position.xy,MAP_CHOICES);
 return mapRequest(p,vec2u(in.ids.x,in.ids.z),in.maps,in.uv,gradX,gradY,(in.ids.y&${FLAG_SAMPLED}u)!=0u);
}
`;
