import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { SSS_COMMON_WGSL } from './commonWgsl.ts'
import { SSS_RADIUS_SCALE_WORD } from './shape.ts'
import { SSS_TILE_TYPE as T } from './layout.ts'

/**
 * WHAT THE SCATTERING READS OF THE SETUP TEXTURE `texA` (`sssSceneColor`): a position held within the viewport's texels, read
 * with the bilinear filter (`SSS_FILTER`) or the nearest texel; and the profile of the texel there from the ids texture — a texel half a
 * texel up and left of the position's, as the ids are stored — when the setup's depth there is above zero, else invalid.
 */
export const SSS_SAMPLE_WGSL = wgslBlock(
  'SSS_SAMPLE_WGSL',
  [SSS_COMMON_WGSL],
  `fn sssSceneColor(uv:vec2f)->vec4f{
 let c=clamp(uv,sssBilinearMin(),sssBilinearMax());
 if(SSS_FILTER){return textureSampleLevel(texA,linearSampler,c,0.0);}
 return textureLoad(texA,vec2i(floor(c*view.sub.zw)),0);
}
fn sssCachedProfile(uv:vec2f,depth:f32)->u32{
 if(depth<=0.0){return SSS_INVALID;}
 let t=vec2u(max(clamp(uv,vec2f(0.0),vec2f(1.0))*view.sub.zw-vec2f(0.5),vec2f(0.0)));
 return textureLoad(texIds,t,0).r;
}
fn sssGbufferProfile(uv:vec2f)->u32{
 let c=clamp(uv,sssBilinearMin(),sssBilinearMax());
 return sssProfileAt(sssPixelAtUv(c));
}
fn sssProfileOrInvalid(uv:vec2f)->u32{
 let c=clamp(uv,sssBilinearMin(),sssBilinearMax());
 let p=sssPixelAtUv(c);
 return select(SSS_INVALID,sssProfileAt(p),sssIsProfile(p));
}`,
)

/**
 * THE SEPARABLE SCATTERING (`sssSeparable`), one pass along each axis: a pixel of a profile keeps its colour weighed by the profile's
 * central weight and adds, on each side, the pixels at the kernel's offsets — the offset of a sample times the radius, the profile's
 * scale over the depth, the opacity of the pixel — weighed by the kernel's colour weights. A sample that is not a profile pixel, or
 * lies at a depth far from the pixel's, adds nothing and takes its share of the weights out; a sample of another profile is tinted by
 * the pixel's boundary colour bleed. The result is divided by the weights it kept per channel; where none was kept, the pixel's colour
 * stays. The alpha of the first pass' result is the pixel's depth; the second pass turns it into a mask. A pixel the sampled
 * scattering handles is left to it unless every profile is scattered this way (\`SSS_FORCE_SEPARABLE\`).
 */
export const SSS_SEPARABLE_WGSL = wgslBlock(
  'SSS_SEPARABLE_WGSL',
  [SSS_SAMPLE_WGSL],
  `fn sssSeparable(pos:vec2u,uv:vec2f,dir:vec2f)->vec4f{
 let center=sssSceneColor(uv);
 let depthHere=center.a;
 if(!(center.a>0.0)){return vec4f(0.0);}
 let pixel=sssPixelAtUv(uv);
 let strength=sssOpacityAt(pixel);
 let stride=view.scatter.x/depthHere*dir*strength;
 var profile=sssProfileAt(pixel);
 if(SSS_CACHE){profile=sssCachedProfile(uv,1.0);}
 let centreWeight=sssKernel(SSS_KERNEL_OFFSET,profile).rgb;
 var accum=center.rgb*centreWeight;
 var divisor=vec3f(0.00001)+centreWeight;
 let bleed=sssBleed(profile);
 for(var i=1u;i<SSS_KERNEL_COUNT;i++){
  let kernel=sssKernel(SSS_KERNEL_OFFSET+i,profile);
  let offset=kernel.a*stride;
  var local=vec4f(0.0);
  for(var side=-1;side<=1;side+=2){
   let luv=uv+offset*f32(side);
   var c=sssSceneColor(luv);
   var other=sssGbufferProfile(luv);
   if(SSS_CACHE){other=sssCachedProfile(luv,c.a);}
   let tint=select(bleed,vec3f(1.0),other==profile||other==SSS_INVALID);
   let depth=c.a;
   c.a=select(0.0,1.0,c.a>0.0);
   let s=saturate(12000.0/400000.0*view.scatter.y*abs(depthHere-depth));
   c.a*=1.0-s;
   c.a*=select(0.0,1.0,other!=SSS_INVALID);
   c=vec4f(c.rgb*c.a*tint,c.a);
   local+=c;
  }
  accum+=kernel.rgb*local.rgb;
  divisor+=kernel.rgb*local.a;
 }
 var result=accum/divisor;
 result=select(result,center.rgb,divisor==vec3f(0.00001));
 return vec4f(result,depthHere);
}
fn sssSeparablePass(g:vec3u,gi:u32,vertical:bool){
 let kind=select(${T.separable}u,${T.nonPassthrough}u,SSS_FORCE_SEPARABLE);
 let index=sssTileIndex(g);
 if(index>=sssCount(kind)){return;}
 let tile=sssTileAt(kind,index);
 let pos=tile*8u+vec2u(gi%8u,gi/8u);
 let uv=(vec2f(pos)+vec2f(0.5))/view.sub.zw;
 if(!SSS_FORCE_SEPARABLE&&sssUseBurley(sssGbufferProfile(uv))){return;}
 var dir=vec2f(1.0,0.0)*${SSS_RADIUS_SCALE_WORD};
 if(vertical){dir=vec2f(0.0,1.0)*${SSS_RADIUS_SCALE_WORD}*(view.sub.z/view.sub.w);}
 dir*=view.sub.x/view.sub.z;
 var out=sssSeparable(pos,uv,dir);
 if(vertical){out.a=select(0.0,1.0,out.a>0.0);}
 if(all(vec2f(pos)<view.sub.xy)){textureStore(outA,pos,out);}
}
@compute @workgroup_size(64)
fn sssSeparableHorizontal(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) gi:u32){sssSeparablePass(g,gi,false);}
@compute @workgroup_size(64)
fn sssSeparableVertical(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) gi:u32){sssSeparablePass(g,gi,true);}`,
)
