import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { hizDepthWgsl } from '../../../visibility/hiz/gpu/pyramidTexture.ts'
import { DFSH_BINDING as B, DFSH_FINAL, DFSH_LIGHT, DFSH_MAX_LIGHTS, DFSH_TILE } from './layout.ts'

/**
 * THE CASCADE'S SHADOW UPSAMPLED INTO THE MASK (`dfshFinalPass`), a thread a pixel of the view: for
 * each of the four lanes a cascade is traced for, the visibility at the pixel — the traced one
 * itself at the display's resolution, else the four texels of the half-resolution result round
 * the pixel (the texel at the pixel's block and the next in each direction, held to the result),
 * weighed by the pixel's bilinear share (0 or a half, the rays having started at the top left of
 * their block), by the inverse of the difference between the depth each was traced at and the
 * pixel's (plus 0.0001), and by whether the cascade reached it: a texel counts only if its depth
 * lies between the cascade's, or it is in shadow (its visibility under one); the weights' sum
 * 0 gives 1 —, faded out toward the cascade's far end and in from its near end (`dfshFade`), and
 * kept by the share the light holds. The lane is the square root of that visibility in a byte, the
 * four in one word, at the pixel's place in the mask (a row of the buffers' width a row, after the
 * word that holds that width); a lane with no cascade holds a visibility of one.
 */
export const DFSH_FINAL_WGSL = wgslProgram(
  `${DFSH_LIGHT.wgsl}
${DFSH_FINAL.wgsl}
@group(0) @binding(${B.final}) var<uniform> dfshFinal:DfshFinal;
@group(0) @binding(${B.half}) var halfFactors:texture_2d<f32>;
@group(0) @binding(${B.mask}) var<storage,read_write> maskOut:array<u32>;
fn dfshFinalDepthCm(z:f32)->f32{
 let distance=select(dfshFinal.depth.y+(1.0-z)*dfshFinal.depth.x,dfshFinal.depth.x/max(z,1e-30),dfshFinal.depth.z>0.5);
 return min(distance*100.0,3.4e38);
}
fn dfshHalfAt(cell:vec2u,layer:u32)->vec2f{
 let rows=(dfshFinal.view.y+dfshFinal.view.z-1u)/dfshFinal.view.z;
 return textureLoad(halfFactors,vec2u(cell.x,layer*rows+cell.y),0).xy;
}
fn dfshUpsampled(pixel:vec2u,depth:f32,light:DfshLight)->f32{
 let layer=light.lane.y;
 let down=dfshFinal.view.z;
 if(down==1u){return dfshHalfAt(pixel,layer).x;}
 let last=vec2u(max(floor(vec2f(dfshFinal.view.xy)/f32(down)),vec2f(1.0)))-vec2u(1u);
 let low=vec2u(floor(vec2f(pixel)/f32(down)));
 let share=(vec2f(pixel)-vec2f(low*down))/f32(down);
 let a=dfshHalfAt(min(low,last),layer);
 let b=dfshHalfAt(min(low+vec2u(1u,0u),last),layer);
 let c=dfshHalfAt(min(low+vec2u(0u,1u),last),layer);
 let d=dfshHalfAt(min(low+vec2u(1u,1u),last),layer);
 let factors=vec4f(a.x,b.x,c.x,d.x);
 let depths=abs(vec4f(a.y,b.y,c.y,d.y));
 let corners=vec4f((1.0-share.y)*(1.0-share.x),(1.0-share.y)*share.x,share.y*(1.0-share.x),share.y*share.x);
 let between=select(vec4f(0.0),vec4f(1.0),depths>vec4f(light.range.x))*select(vec4f(0.0),vec4f(1.0),depths<vec4f(light.range.y));
 let reached=max(between,select(vec4f(0.0),vec4f(1.0),factors<vec4f(1.0)));
 let weights=corners*reached/(abs(depths-vec4f(depth))+vec4f(0.0001));
 let total=dot(weights,vec4f(1.0));
 return select(1.0,dot(factors,weights)/total,total!=0.0);
}
fn dfshFade(visibility:f32,depth:f32,light:DfshLight)->f32{
 var faded=mix(1.0,visibility,1.0-saturate((depth-light.range.z)*light.range.w));
 faded=mix(1.0,faded,saturate((depth-light.fade.x)*light.fade.y));
 return mix(1.0,faded,light.fade.z);
}
@compute @workgroup_size(${DFSH_TILE},${DFSH_TILE})
fn dfshFinalPass(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dfshFinal.view.xy)){return;}
 let depth=dfshFinalDepthCm(hizOpaqueDepth(vec2i(id.xy)));
 var word=0u;
 for(var lane=0u;lane<${DFSH_MAX_LIGHTS}u;lane++){
  let light=dfshFinal.lights[lane];
  var visibility=1.0;
  if(light.lane.x!=0u){visibility=dfshFade(dfshUpsampled(id.xy,depth,light),depth,light);}
  word|=u32(sqrt(saturate(visibility))*255.0+0.5)<<(8u*lane);
 }
 let stride=dfshFinal.extent.x;
 maskOut[1u+id.y*stride+id.x]=word;
 if(id.x==0u&&id.y==0u){maskOut[0]=stride;}
}`,
  [hizDepthWgsl(0, B.depth)],
)
