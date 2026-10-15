import { FLAG_SAMPLED } from '../../visibility/types.ts'
import { FEEDBACK_RULE_WGSL, TILE_REQUEST_WGSL, requestLoopWgsl } from '../tile/requestWgsl.ts'
import { BLEND_PHYSICAL_RECORD_WGSL } from './physicalWgsl.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * Tile rank a transparent pixel requests from the virtual textures, stored in the second
 * target of the blend pass, the one the opaque resolve opened. The rule — phase, map chosen
 * by position, every pick during a convergence, fallback to the base — is `TILE_REQUEST_WGSL`
 * and its loop `requestLoopWgsl`, the same as the opaque path; only the slot source is the item's. The host shader declares
 * `VSOut` and `uni.feedback`.
 *
 * With `lobes`, a lobed program's: a fragment whose item names a physical record (`physicalOn`,
 * `physicalWgsl.ts`) asks for its four maps' tiles after the others, each at its own UV set
 * (`physicalRequest`, `BLEND_PHYSICAL_RECORD_WGSL`'s lobes core), as an opaque row does
 * (`../../visibility/shader/request.ts`).
 */
export const blendRequestWgsl = (lobes: boolean) => {
  const sampled = `(in.ids.y&${FLAG_SAMPLED}u)!=0u`
  return wgslBlock(
    `blendRequestWgsl(${lobes})`,
    [TILE_REQUEST_WGSL, FEEDBACK_RULE_WGSL, ...(lobes ? [BLEND_PHYSICAL_RECORD_WGSL] : [])],
    `/** The subsurface map's choice: one where the item's surface has the map, after the others. */
fn blendSubsurfaceChoices(in:VSOut)->u32{return select(0u,1u,in.emissive.w!=0.0);}
fn blendPick(in:VSOut,p:RequestPick,missing:bool,gradX:vec2f,gradY:vec2f)->u32{
 ${lobes ? `let first=MAP_CHOICES+blendSubsurfaceChoices(in);if(physicalOn&&p.sel>=first){return physicalRequest(p,missing,p.sel-first);}\n ` : ''}if(p.sel==MAP_CHOICES){return colorRequestIndex(u32(in.emissive.w),in.uv.xy,gradX,gradY,p.next,1u,false,${sampled},missing);}
 return mapRequest(p,missing,vec2u(in.ids.x,in.ids.z),in.maps,in.uv.xy,gradX,gradY,${sampled});
}
${requestLoopWgsl({
  head: 'fn blendRequest(in:VSOut,gradX:vec2f,gradY:vec2f)->u32',
  pos: 'in.position.xy',
  word: 'uni.feedback',
  choices: `MAP_CHOICES+blendSubsurfaceChoices(in)${lobes ? '+select(0u,4u,physicalOn)' : ''}`,
  pick: (p, missing) => `blendPick(in,${p},${missing},gradX,gradY)`,
})}
`,
  )
}
