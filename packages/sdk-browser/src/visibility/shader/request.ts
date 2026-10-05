/**
 * What an opaque pixel asks of virtual textures: ONE tile rank, placed in the frame's
 * feedback target that transparents complete, under the common `TILE_REQUEST_WGSL` rule
 * (phase, map chosen by position, fallback on the base). The pixel increments nothing: why,
 * and what that cost, is said in `../../webgpu/tile/reduce.ts`.
 *
 * The host shader declares `uni.feedback`, `PageInfo`, `TILE_REQUEST_WGSL` and the class overrides —
 * `HAS_UV`, `HAS_MASK`, `HAS_SAMPLING` and one per map (`materialClass.ts`) — before this block;
 * the triangle's corners and texture coordinates come from the resolve (`decodeTriangle`).
 */
/** Words of the resolve uniform: the view-projection, the viewport, the pixel ratio, the mip bias, the page count, the mode and the
 *  feedback word,
 *  one padding word, then the depth ramp (`writeDepthRamp`, `../../camera/depthConvention.ts`) at
 *  `DEPTH_RAMP_WORD`. */
export const DEPTH_RAMP_WORD = 24;
export const SHADE_UNIFORM_WORDS = DEPTH_RAMP_WORD + 4;
export const SHADE_UNIFORM_BYTES = SHADE_UNIFORM_WORDS * 4;

export const SHADE_REQUEST_WGSL = `
/** A class reading any map asks for its tiles: a normal map alone is still a texture to stream. */
override ANY_MAP:bool=HAS_MAP||HAS_ROUGH||HAS_METAL||HAS_NORMAL_MAP||HAS_AO||HAS_EMISSIVE;
/** Tile rank pick \`p\` of this pixel names, plus one, or zero (\`missing\`: only a tile not held). */
fn shadePick(p:RequestPick,missing:bool,page:PageInfo,uv:vec2f,ddx:vec2f,ddy:vec2f)->u32{
 if(p.sel==MAP_CHOICES+1u){return colorRequestIndex(page.subsurfaceMap,uv,ddx,ddy,p.next,1u,false,HAS_SAMPLING,missing);}
 return mapRequest(p,missing,vec2u(page.mapIndex,page.emissiveIndex),vec4u(page.roughnessIndex,page.metalnessIndex,page.normalIndex,page.aoIndex),uv,ddx,ddy,HAS_SAMPLING);
}
/** Tile rank this pixel asks for, plus one, or zero: during a convergence, the first of its picks
 *  whose tile is missing (\`everyPick\`), else its own. */
fn shadeRequest(page:PageInfo,pos:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f)->u32{
 if(!(HAS_UV&&(ANY_MAP||page.subsurfaceMap!=0u))||!feedbackPhase(pos,uni.feedback)){return 0u;}
 let choices=MAP_CHOICES+1u+select(0u,1u,page.subsurfaceMap!=0u);
 if(feedbackEvery(uni.feedback)){
  for(var turn=0u;turn<choices*PICK_TURNS;turn++){
   let rank=shadePick(everyPick(pos,choices,turn),true,page,uv,ddx,ddy);
   if(rank!=0u){return rank;}
  }
 }
 return shadePick(requestPick(pos,choices,uni.feedback),false,page,uv,ddx,ddy);
}`;
