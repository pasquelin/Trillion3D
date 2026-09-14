export const HIZ_SHADER = `struct Uni{a:u32,b:u32,c:u32,d:u32,e:u32,f:u32,g:u32,h:u32,}
struct Bounds{minX:i32,minY:i32,maxX:i32,maxY:i32,nearest:f32,rowAndClip:u32,pad0:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read_write> pyramid:array<f32>;
@group(0) @binding(1) var level0:texture_2d<f32>;
@group(0) @binding(2) var<uniform> uni:Uni;
@group(0) @binding(3) var<storage, read> bounds:array<Bounds>;
@group(0) @binding(4) var<storage, read_write> flags:array<u32>;
@compute @workgroup_size(8, 8)
fn copyDepth(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.a||id.y>=uni.b){return;}
 let z=textureLoad(level0,vec2i(i32(id.x),i32(id.y)),0).r;
 pyramid[uni.c+id.y*uni.a+id.x]=z;
}
@compute @workgroup_size(8, 8)
fn reduceHiz(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=uni.e||id.y>=uni.f){return;}
 let x0=id.x*2u;let y0=id.y*2u;
 var far=pyramid[uni.a+y0*uni.b+x0];
 if(x0+1u<uni.b){far=max(far,pyramid[uni.a+y0*uni.b+x0+1u]);}
 if(y0+1u<uni.c){
  far=max(far,pyramid[uni.a+(y0+1u)*uni.b+x0]);
  if(x0+1u<uni.b){far=max(far,pyramid[uni.a+(y0+1u)*uni.b+x0+1u]);}
 }
 pyramid[uni.d+id.y*uni.e+id.x]=far;
}
fn footprintFar(b:Bounds)->f32{
 let x0=b.minX;let y0=b.minY;let x1=b.maxX+1;let y1=b.maxY+1;
 if(x1<=x0||y1<=y0){return 1.0;}
 if(x1-x0>16||y1-y0>16){return 1.0;}
 var far=-1.0e30;var hit=false;
 for(var y=y0;y<y1;y++){
  for(var x=x0;x<x1;x++){
   far=max(far,pyramid[b.pad0+u32(y)*b.pad1+u32(x)]);
   hit=true;
  }
 }
 if(!hit){return 1.0;}
 return far;
}
// Only the boxes tested this frame travel to the GPU, so each carries the flag row it answers for;
// the rows the frame does not test were cleared to zero before this pass.
@compute @workgroup_size(64)
fn testHiz(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=uni.c){return;}
 let b=bounds[i];
 let row=b.rowAndClip>>1u;
 if((b.rowAndClip&1u)!=0u||b.maxX<b.minX||b.maxY<b.minY){flags[row]=0u;return;}
 let far=footprintFar(b);
 let bias=bitcast<f32>(uni.d);
 flags[row]=select(0u,1u,b.nearest>far+bias);
}
`;
