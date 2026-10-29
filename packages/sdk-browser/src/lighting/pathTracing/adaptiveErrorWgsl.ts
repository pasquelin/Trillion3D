import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * ONE LEVEL OF THE ERROR'S MIP CHAIN the adaptive sampling reads (`ptAdaptiveErrorLevel`): the pixel `out` of a level
 * `outRes` wide, made from the pixels of the level above, `inRes` wide, that it covers. A pixel is (the mean of its error, the
 * mean of its squared error, its sample count, 0); two pixels are combined by `ptCombinePixels` so that the result is the weighted mean of both
 * with the samples interpolated, which makes a level of an odd size share the odd row and column between the pixels
 * that touch them (two pixels without samples give a pixel without samples, where a division of zero by zero would give none a number). The caller's `ptErrorInput(coord)` reads the level above; the samples of the result count four times
 * as many, as the pixel stands for four. On an odd size the pixel on the right of a pair weighs its own share of the covered span (the first and the second pixels of a row weigh `w0` and `w1`, so the second weighs `w1 / (w0 + w1)`: the reference gives it the first one's share, a bug fixed here).
 */
export const PT_ADAPTIVE_ERROR_WGSL = wgslBlock(
  'PT_ADAPTIVE_ERROR_WGSL',
  [],
  `fn ptCombinePixels(a:vec4f,b:vec4f,w:f32)->vec4f{
 let samples=mix(a.z,b.z,w);
 let inverse=select(0.0,1.0/samples,samples>0.0);
 let ratioA=a.z*inverse;
 let ratioB=b.z*inverse;
 return vec4f(mix(a.xy*ratioA,b.xy*ratioB,w),samples,0.0);
}
fn ptErrorRow(at:vec2i,row:i32,odd:bool,w0:f32,w1:f32,w2:f32)->vec4f{
 let p=at+vec2i(0,row);
 var r=ptCombinePixels(ptErrorInput(p),ptErrorInput(p+vec2i(1,0)),select(0.5,w1/(w0+w1),odd));
 if(odd){r=ptCombinePixels(r,ptErrorInput(p+vec2i(2,0)),w2);}
 return r;
}
fn ptAdaptiveErrorLevel(out:vec2i,inRes:vec2i,outRes:vec2i)->vec4f{
 let oddX=(inRes.x&1)==1;
 let oddY=(inRes.y&1)==1;
 let w0x=f32(outRes.x-out.x)/f32(inRes.x);
 let w1x=f32(outRes.x)/f32(inRes.x);
 let w2x=f32(1+out.x)/f32(inRes.x);
 let w0y=f32(outRes.y-out.y)/f32(inRes.y);
 let w1y=f32(outRes.y)/f32(inRes.y);
 let w2y=f32(1+out.y)/f32(inRes.y);
 let at=2*out;
 let r0=ptErrorRow(at,0,oddX,w0x,w1x,w2x);
 let r1=ptErrorRow(at,1,oddX,w0x,w1x,w2x);
 var r=ptCombinePixels(r0,r1,select(0.5,w1y/(w0y+w1y),oddY));
 if(oddY){r=ptCombinePixels(r,ptErrorRow(at,2,oddX,w0x,w1x,w2x),w2y);}
 return vec4f(r.xy,r.z*4.0,r.w);
}`,
)

/** The kernel that writes a level of the chain from the one above, 8 by 8 pixels a group. */
export const PT_ADAPTIVE_ERROR_ENTRY = 'ptBuildAdaptiveError'

/** The program: the level above is a texture (`ptErrorSource`), the level written a storage texture, the sizes of both a uniform. */
export const PT_ADAPTIVE_ERROR_KERNEL_WGSL = wgslBlock(
  'PT_ADAPTIVE_ERROR_KERNEL_WGSL',
  [PT_ADAPTIVE_ERROR_WGSL],
  `struct PtErrorLevels{inRes:vec2i,outRes:vec2i}
@group(0) @binding(0) var<uniform> ptLevels:PtErrorLevels;
@group(0) @binding(1) var ptErrorSource:texture_2d<f32>;
@group(0) @binding(2) var ptErrorTarget:texture_storage_2d<rgba32float,write>;
fn ptErrorInput(coord:vec2i)->vec4f{return textureLoad(ptErrorSource,coord,0);}
@compute @workgroup_size(8,8,1)
fn ${PT_ADAPTIVE_ERROR_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 let out=vec2i(id.xy);
 if(any(out>=ptLevels.outRes)){return;}
 textureStore(ptErrorTarget,out,ptAdaptiveErrorLevel(out,ptLevels.inRes,ptLevels.outRes));
}`,
)
