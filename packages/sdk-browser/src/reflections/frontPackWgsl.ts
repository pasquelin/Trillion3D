import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { maxChannel } from '../../../math/src/wgsl/sampling.ts'

/**
 * The front layer's codec (`FRONT_TRACED_FORMAT`, `frontLayer.ts`): a radiance on a shared exponent,
 * nine bits a channel (rgb9e5), a colour in one word. One home: the reflections' upsample packs
 * (`upsampleWgsl.ts`), the forward fragments unpack (`forwardTrace`).
 */
export const FRONT_PACK_WGSL = wgslBlock(
  'FRONT_PACK_WGSL',
  [maxChannel],
  `fn frontPack(c:vec3f)->u32{
 let v=clamp(c,vec3f(0.0),vec3f(65408.0));
 let top=maxChannel(v);
 var exponent=max(-16.0,floor(log2(max(top,1e-30))))+16.0;
 var step=exp2(exponent-24.0);
 if(floor(top/step+0.5)>=512.0){exponent+=1.0;step*=2.0;}
 let m=vec3u(floor(v/step+vec3f(0.5)));
 return m.x|(m.y<<9u)|(m.z<<18u)|(u32(exponent)<<27u);
}
fn frontUnpack(w:u32)->vec3f{
 let m=vec3f(f32(w&511u),f32((w>>9u)&511u),f32((w>>18u)&511u));
 return m*exp2(f32(w>>27u)-24.0);
}`,
)
