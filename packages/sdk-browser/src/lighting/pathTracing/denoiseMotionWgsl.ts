import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { DN_COLOR_WGSL, DN_SAMPLING_WGSL } from './denoiseColorWgsl.ts'

/** The entries of the motion estimate's kernels. */
export const DN_MOTION_ENTRIES = {
  mip: 'dnMip',
  align: 'dnAlign',
  blur: 'dnBlur',
  merge: 'dnMerge',
  subtract: 'dnSubtract',
} as const

/** The bit of `DnParams.flags` that fits a sub-pixel offset, and the one that measures the total variation. */
export const DN_FLAG_SUBPIXEL = 1
export const DN_FLAG_TOTAL_VARIATION = 2

/**
 * THE UNIFORM THE DENOISER'S KERNELS READ, 64 bytes: the view's size, the level of the pyramid a pass works at, the patch it estimates, the number of patches, the distance metric, the flags, the sample the
 * prepass is at, the pre-exposure to the display, the temporal blend (`kappa`, `eta`, `alpha`), the colour difference above which a pixel's history is cut. `dnOffsetFromLower` reads the motion estimated one step coarser
 * (`DN_MIP_STEP` levels up, bound as a texture of that one level; bicubic, scaled back to this level's pixels).
 */
export const DN_PARAMS_WGSL = wgslBlock(
  'DN_PARAMS_WGSL',
  [DN_SAMPLING_WGSL],
  `struct DnParams{
 size:vec2u,mip:u32,patchId:u32,
 patchCount:u32,metric:u32,flags:u32,iteration:u32,
 exposure:f32,kappa:f32,eta:f32,alpha:f32,
 cutoff:f32,spare0:f32,spare1:f32,spare2:f32}
@group(0) @binding(0) var<uniform> dn:DnParams;
struct DnOffset{xy:vec2f,dist:f32,tv:f32}
fn dnOffsetFromLower(t:texture_2d<f32>,position:vec2f,diff:u32)->DnOffset{
 let scale=f32(1u<<diff);
 var lower=position;
 if(diff!=0u){lower=(position-vec2f(1.0))/scale-vec2f(0.5);}
 let extent=vec2f(dn.size>>vec2u(dn.mip+diff));
 let o=dnBicubic(t,0,(lower+vec2f(0.5))/extent,extent);
 return DnOffset(scale*o.xy,o.z,o.w);
}`,
)

const MIP_WGSL = `@group(0) @binding(1) var dnSource:texture_2d<f32>;
@group(0) @binding(2) var dnOut:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(8,8,1)
fn ${DN_MOTION_ENTRIES.mip}(@builtin(global_invocation_id) id:vec3u){
 let outside=vec2u(textureDimensions(dnOut));
 if(any(id.xy>=outside)){return;}
 let inside=vec2f(textureDimensions(dnSource,0));
 let p=(vec2f(id.xy)+vec2f(0.5))*inside/vec2f(outside)-vec2f(0.5);
 textureStore(dnOut,vec2i(id.xy),dnBilerp(dnSource,0,p));
}`

const ALIGN_WGSL = `@group(0) @binding(1) var dnOffsets:texture_2d<f32>;
@group(0) @binding(2) var dnFrom:texture_2d<f32>;
@group(0) @binding(3) var dnTo:texture_2d<f32>;
@group(0) @binding(4) var dnDistancesOut:texture_storage_2d_array<rgba32float,write>;
fn dnShift(index:u32)->vec2i{return vec2i(i32(index%5u)-2,i32(index/5u)-2);}
@compute @workgroup_size(8,8,1)
fn ${DN_MOTION_ENTRIES.align}(@builtin(global_invocation_id) id:vec3u){
 let extent=dn.size>>vec2u(dn.mip);
 if(any(id.xy>=extent)||id.z>=7u){return;}
 let level=i32(dn.mip);
 let here=vec2f(id.xy);
 let newer=dnBilerp(dnTo,level,here).rgb*dn.exposure;
 var distances=vec4f(0.0);
 for(var i=0u;i<4u;i++){
  let index=id.z*4u+i;
  if(index>=25u){break;}
  let shift=dnShift(index);
  let at=here+vec2f(shift);
  let moved=at+dnOffsetFromLower(dnOffsets,at,2u).xy;
  let older=dnBilerp(dnFrom,level,moved).rgb*dn.exposure;
  distances[i]=dnDistance(newer,older,shift,dn.metric);
 }
 textureStore(dnDistancesOut,vec2i(id.xy),i32(id.z),distances);
}`

const BLUR_WGSL = `@group(0) @binding(1) var dnBlurIn:texture_2d<f32>;
@group(0) @binding(2) var dnBlurOut:texture_storage_2d<rgba32float,write>;
@compute @workgroup_size(8,8,1)
fn ${DN_MOTION_ENTRIES.blur}(@builtin(global_invocation_id) id:vec3u){
 let extent=dn.size>>vec2u(dn.mip);
 if(any(id.xy>=extent)){return;}
 let step=f32(1u<<dn.mip)*vec2f(extent)/vec2f(dn.size);
 var sum=vec4f(0.0);
 for(var y=-1;y<=1;y++){
  for(var x=-1;x<=1;x++){
   sum+=dnBilerp(dnBlurIn,0,vec2f(id.xy)+vec2f(f32(x),f32(y))*step);
  }
 }
 textureStore(dnBlurOut,vec2i(id.xy),sum/9.0);
}`

const MERGE_WGSL = `@group(0) @binding(1) var dnOffsets:texture_2d<f32>;
@group(0) @binding(2) var dnDistances:texture_2d_array<f32>;
@group(0) @binding(3) var dnMergeOut:texture_storage_2d<rgba32float,write>;
fn dnGetOffsets(position:vec2i,offset:vec2i)->f32{
 let o=clamp(offset,vec2i(-2),vec2i(2));
 let index=o.x+o.y*5+12;
 let p=position+o;
 let extent=vec2i(dn.size>>vec2u(dn.mip));
 if(any(p<vec2i(0))||any(p>=extent)){return 0.0;}
 return textureLoad(dnDistances,p,index/4,i32(dn.mip))[index%4];
}
fn dnDot9(a:array<f32,9>,b:array<f32,9>)->f32{
 var x=a;
 var y=b;
 var s=0.0;
 for(var i=0;i<9;i++){s+=x[i]*y[i];}
 return s;
}
fn dnSubpixel(d:array<f32,9>)->vec2f{
 let fa11=array<f32,9>(1.0,-2.0,1.0,2.0,-4.0,2.0,1.0,-2.0,1.0);
 let fa22=array<f32,9>(0.25,0.5,0.25,-0.5,-1.0,-0.5,0.25,0.5,0.25);
 let fa12=array<f32,9>(0.25,0.0,-0.25,0.0,0.0,0.0,-0.25,0.0,0.25);
 let fb1=array<f32,9>(-0.125,0.0,0.125,-0.25,0.0,0.25,-0.125,0.0,0.125);
 let fb2=array<f32,9>(-0.125,-0.25,-0.125,0.0,0.0,0.0,0.125,0.25,0.125);
 let a11=max(0.0,dnDot9(fa11,d));
 var a12=dnDot9(fa12,d);
 let a22=max(0.0,dnDot9(fa22,d));
 var det=a11*a22-a12*a12;
 if(det<0.0){a12=0.0;det=a11*a22;}
 let b0=dnDot9(fb1,d);
 let b1=dnDot9(fb2,d);
 if(abs(det)>1e-9){
  let mu=vec2f(-(a22*b0-a12*b1)/det,-(a11*b1-a12*b0)/det);
  if(dot(mu,mu)<1.0){return mu;}
 }
 return vec2f(0.0);
}
struct DnBest{slice:u32,comp:u32,value:f32}
fn dnMin4(v:vec4f)->vec2f{
 let xy=select(1u,0u,v.x<=v.y);
 let zw=select(3u,2u,v.z<=v.w);
 let pick=select(zw,xy,v[xy]<=v[zw]);
 return vec2f(f32(pick),v[pick]);
}
fn dnBestShift(position:vec2i,kth:u32)->DnBest{
 let level=i32(dn.mip);
 var best=DnBest(3u,0u,3.0e38);
 var values=array<f32,4>(3.0e38,3.0e38,3.0e38,3.0e38);
 var picks=array<u32,4>(0u,0u,0u,0u);
 var order=array<u32,7>(3u,1u,2u,4u,0u,5u,6u);
 for(var k=0;k<7;k++){
  let slice=order[k];
  let v=textureLoad(dnDistances,position,i32(slice),level);
  if(kth==0u){
   var m=dnMin4(v);
   if(slice==6u){m=vec2f(0.0,v.x);}
   if(m.y<best.value||k==0){best=DnBest(slice,u32(m.x),m.y);}
  }else{
   let count=select(4,1,slice==6u);
   for(var c=0;c<count;c++){
    var value=v[c];
    var pick=slice*4u+u32(c);
    for(var s=0;s<4;s++){
     if(value<values[s]){
      let keepValue=values[s];
      let keepPick=picks[s];
      values[s]=value;picks[s]=pick;
      value=keepValue;pick=keepPick;
     }
    }
   }
  }
 }
 if(kth>0u){
  let at=min(kth,3u);
  best=DnBest(picks[at]/4u,picks[at]%4u,values[at]);
 }
 return best;
}
fn dnTotalVariation(shifted:vec2i)->f32{
 var total=0.0;
 for(var i=-2;i<2;i++){
  for(var j=-2;j<2;j++){
   let v=dnGetOffsets(shifted,vec2i(i,j));
   total+=abs(dnGetOffsets(shifted,vec2i(i+1,j))-v)+abs(dnGetOffsets(shifted,vec2i(i,j+1))-v);
  }
 }
 for(var j=-2;j<2;j++){
  total+=abs(dnGetOffsets(shifted,vec2i(2,j))-dnGetOffsets(shifted,vec2i(2,j+1)));
 }
 for(var i=-2;i<1;i++){
  total+=abs(dnGetOffsets(shifted,vec2i(i,2))-dnGetOffsets(shifted,vec2i(i+1,2)));
 }
 return total;
}
@compute @workgroup_size(8,8,1)
fn ${DN_MOTION_ENTRIES.merge}(@builtin(global_invocation_id) id:vec3u){
 let extent=dn.size>>vec2u(dn.mip);
 if(any(id.xy>=extent)){return;}
 let position=vec2i(id.xy);
 var kth=0u;
 if(dn.mip==0u){kth=dn.patchId/4u;}
 else if(dn.mip==2u){kth=dn.patchId%4u;}
 let best=dnBestShift(position,kth);
 let index=best.slice*4u+best.comp;
 let shift=vec2i(i32(index%5u)-2,i32(index/5u)-2);
 var offset=vec2f(shift);
 if((dn.flags&${DN_FLAG_SUBPIXEL}u)!=0u){
  let shifted=position+shift;
  var d=array<f32,9>(0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0);
  for(var r=0;r<3;r++){
   for(var c=0;c<3;c++){
    d[r*3+c]=dnGetOffsets(shifted,vec2i(c-1,r-1));
   }
  }
  d[4]=best.value;
  offset+=dnSubpixel(d);
 }
 let lower=dnOffsetFromLower(dnOffsets,vec2f(id.xy),2u);
 let total=offset+lower.xy;
 var tv=1.0;
 if((dn.flags&${DN_FLAG_TOTAL_VARIATION}u)!=0u){tv=dnTotalVariation(position+shift);}
 textureStore(dnMergeOut,position,vec4f(total,best.value,tv));
}`

const SUBTRACT_WGSL = `@group(0) @binding(1) var dnMinuend:texture_2d<f32>;
@group(0) @binding(2) var dnSubtrahend:texture_2d<f32>;
@group(0) @binding(3) var dnSubtractOut:texture_storage_2d<rgba32float,write>;
fn dnWeightMultiplier(sourceTv:f32,targetTv:f32)->f32{
 let delta=-(targetTv-sourceTv);
 let depth=0.2;
 return 1.0/(1.0+exp(-10.0*delta))*depth+(1.0-depth/2.0);
}
@compute @workgroup_size(8,8,1)
fn ${DN_MOTION_ENTRIES.subtract}(@builtin(global_invocation_id) id:vec3u){
 let extent=dn.size>>vec2u(dn.mip);
 if(any(id.xy>=extent)){return;}
 let position=vec2i(id.xy);
 let m=textureLoad(dnMinuend,position,0);
 let s=textureLoad(dnSubtrahend,position,0);
 var result=vec4f(m.x-s.x,m.y-s.y,m.z,dnWeightMultiplier(s.w,m.w));
 let last=vec2i(extent)-vec2i(12);
 if(any(position>last)||any(position-vec2i(12)<vec2i(0))){result.w=1.0;}
 textureStore(dnSubtractOut,position,result);
}`

/** The kernels of the motion estimate: the level of the pyramid (and the copy into the first), the distances of 25 shifts, their blur, the best shift with its sub-pixel offset, the subtraction of the image's own. */
export const DN_MOTION_PROGRAMS = {
  mip: wgslProgram(MIP_WGSL, [DN_PARAMS_WGSL]),
  align: wgslProgram(ALIGN_WGSL, [DN_PARAMS_WGSL, DN_COLOR_WGSL]),
  blur: wgslProgram(BLUR_WGSL, [DN_PARAMS_WGSL]),
  merge: wgslProgram(MERGE_WGSL, [DN_PARAMS_WGSL]),
  subtract: wgslProgram(SUBTRACT_WGSL, [DN_PARAMS_WGSL]),
} as const
