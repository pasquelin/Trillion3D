import { SHADE_UNIFORM } from './uniformLayout.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * What an opaque pixel asks of virtual textures: ONE tile rank, placed in the frame's
 * feedback target that transparents complete, under the common `TILE_REQUEST_WGSL` rule
 * (phase, map chosen by position, fallback on the base). The pixel increments nothing: why,
 * and what that cost, is said in `../../webgpu/tile/reduce.ts`.
 *
 * The host shader declares `uni.feedback`, `PageInfo`, `Material` (its maps' slots the surface's
 * record's, `materialAt`), `TILE_REQUEST_WGSL` and the class overrides —
 * `HAS_UV`, `HAS_MASK`, `HAS_SAMPLING` and one per map (`materialClass.ts`) — before this block;
 * the triangle's corners and texture coordinates come from the resolve (`decodeTriangle`). A row
 * whose surface carries an anisotropic or clear-coat lobe (`physicalOn`) adds its four maps' picks
 * after the others, each read where its record says (`physicalRequest`, `physicalWgsl.ts`).
 */
/** Words of the resolve uniform (`SHADE_UNIFORM`). */
export const SHADE_UNIFORM_WORDS = SHADE_UNIFORM.words
export const SHADE_UNIFORM_BYTES = SHADE_UNIFORM_WORDS * 4

export const SHADE_REQUEST_WGSL = wgslBlock(
  'SHADE_REQUEST_WGSL',
  [],
  `
/** A class reading any map asks for its tiles: a normal map alone is still a texture to stream. */
override ANY_MAP:bool=HAS_MAP||HAS_ROUGH||HAS_METAL||HAS_NORMAL_MAP||HAS_AO||HAS_EMISSIVE;
/** Tile rank pick \`p\` of this pixel names, plus one, or zero (\`missing\`: only a tile not held). */
fn shadePick(p:RequestPick,missing:bool,m:Material,uv:vec2f,ddx:vec2f,ddy:vec2f)->u32{
 // The anisotropic and clear-coat maps after the others, each at its own UV set (\`physicalWgsl.ts\`).
 let physicalFirst=MAP_CHOICES+1u+select(0u,1u,m.subsurfaceMap!=0u);
 if(HAS_PHYSICAL&&physicalOn&&p.sel>=physicalFirst){return physicalRequest(p,missing,p.sel-physicalFirst);}
 if(p.sel==MAP_CHOICES+1u){return colorRequestIndex(m.subsurfaceMap,uv,ddx,ddy,p.next,1u,false,HAS_SAMPLING,missing);}
 return mapRequest(p,missing,vec2u(m.mapIndex,m.emissiveIndex),vec4u(m.roughnessIndex,m.metalnessIndex,m.normalIndex,m.aoIndex),uv,ddx,ddy,HAS_SAMPLING);
}
/** Tile rank this pixel asks for, plus one, or zero: on a convergence's asking rows
 *  (\`feedbackMissing\`), the first of its picks whose tile is missing (\`everyPick\`), else its
 *  own — the tile it reads, stamped. */
fn shadeRequest(m:Material,pos:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f)->u32{
 let physical=HAS_PHYSICAL&&physicalOn;
 if(!(HAS_UV&&(ANY_MAP||m.subsurfaceMap!=0u||physical))||!feedbackPhase(pos,uni.feedback)){return 0u;}
 let choices=MAP_CHOICES+1u+select(0u,1u,m.subsurfaceMap!=0u)+select(0u,4u,physical);
 if(feedbackMissing(pos,uni.feedback)){
  for(var turn=0u;turn<choices*PICK_TURNS;turn++){
   let rank=shadePick(everyPick(pos,choices,turn),true,m,uv,ddx,ddy);
   if(rank!=0u){return rank;}
  }
 }
 return shadePick(requestPick(pos,choices,uni.feedback),false,m,uv,ddx,ddy);
}`,
)
