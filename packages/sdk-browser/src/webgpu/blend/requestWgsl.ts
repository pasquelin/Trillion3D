import { FLAG_SAMPLED } from '../../visibility/types.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * Tile rank a transparent pixel requests from the virtual textures, stored in the second
 * target of the blend pass, the one the opaque resolve opened. The rule — phase, map chosen
 * by position, every pick during a convergence, fallback to the base — is `TILE_REQUEST_WGSL`,
 * the same as the opaque path; only the slot source is the item's. The host shader declares
 * `VSOut`, `uni.feedback` and lists `TILE_REQUEST_WGSL`.
 *
 * With `lobes`, a lobed program's: a fragment whose item names a physical record (`physicalOn`,
 * `physicalWgsl.ts`) asks for its four maps' tiles after the others, each at its own UV set
 * (`physicalRequest`), as an opaque row does (`../../visibility/shader/request.ts`).
 */
export const blendRequestWgsl = (lobes: boolean) => {
  const sampled = `(in.ids.y&${FLAG_SAMPLED}u)!=0u`
  const own = lobes ? 'select(0u,1u,in.emissive.w!=0.0)' : ''
  return wgslBlock(
    `blendRequestWgsl(${lobes})`,
    [],
    `fn blendPick(in:VSOut,p:RequestPick,missing:bool,gradX:vec2f,gradY:vec2f)->u32{
 ${lobes ? `if(physicalOn&&p.sel>=MAP_CHOICES+${own}){return physicalRequest(p,missing,p.sel-MAP_CHOICES-${own});}\n ` : ''}if(p.sel==MAP_CHOICES){return colorRequestIndex(u32(in.emissive.w),in.uv.xy,gradX,gradY,p.next,1u,false,${sampled},missing);}
 return mapRequest(p,missing,vec2u(in.ids.x,in.ids.z),in.maps,in.uv.xy,gradX,gradY,${sampled});
}
fn blendRequest(in:VSOut,gradX:vec2f,gradY:vec2f)->u32{
 if(!feedbackPhase(in.position.xy,uni.feedback)){return 0u;}
 let choices=MAP_CHOICES+select(0u,1u,in.emissive.w!=0.0)${lobes ? '+select(0u,4u,physicalOn)' : ''};
 if(feedbackEvery(uni.feedback)){
  for(var turn=0u;turn<choices*PICK_TURNS;turn++){
   let rank=blendPick(in,everyPick(in.position.xy,choices,turn),true,gradX,gradY);
   if(rank!=0u){return rank;}
  }
 }
 return blendPick(in,requestPick(in.position.xy,choices,uni.feedback),false,gradX,gradY);
}
`,
  )
}
