import { ST_REJECTED, ST_REJECTED_TRIANGLES, ST_TESTED } from './gpuPartitionContract.ts';

/**
 * Les trois noyaux de la pyramide Hi-Z. Le test ne reçoit plus ni compte ni octets du processeur :
 * il lit le nombre de boîtes et écrit ses propres compteurs d'élimination dans l'état que la
 * partition GPU tient, et les boîtes sont celles que la partition a empaquetées dans la même
 * soumission. Aucune valeur n'y est déduite : un verdict est écrit, ou la ligne reste à zéro.
 */
export const HIZ_SHADER = `struct Uni{a:u32,b:u32,c:u32,d:u32,e:u32,f:u32,g:u32,h:u32,}
struct Bounds{minX:i32,minY:i32,maxX:i32,maxY:i32,nearest:f32,rowAndClip:u32,pad0:u32,pad1:u32,triangles:u32,pad2:u32,pad3:u32,pad4:u32,}
@group(0) @binding(0) var<storage, read_write> pyramid:array<f32>;
@group(0) @binding(1) var level0:texture_2d<f32>;
@group(0) @binding(2) var<uniform> uni:Uni;
@group(0) @binding(3) var<storage, read> bounds:array<Bounds>;
@group(0) @binding(4) var<storage, read_write> flags:array<u32>;
@group(0) @binding(5) var<storage, read_write> state:array<atomic<u32>>;
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
// Seules les boîtes que l'image teste voyagent jusqu'ici, chacune portant la ligne de verdict dont
// elle répond ; les lignes que l'image ne teste pas ont été remises à zéro avant cette passe. Le
// nombre de boîtes est celui que la partition a compacté : le processeur ne le connaît pas.
@compute @workgroup_size(64)
fn testHiz(@builtin(global_invocation_id) id:vec3u){
 let i=id.x;if(i>=atomicLoad(&state[${ST_TESTED}u])){return;}
 let b=bounds[i];
 let row=b.rowAndClip>>1u;
 if((b.rowAndClip&1u)!=0u||b.maxX<b.minX||b.maxY<b.minY){flags[row]=0u;return;}
 let far=footprintFar(b);
 let bias=bitcast<f32>(uni.d);
 let reject=select(0u,1u,b.nearest>far+bias);
 flags[row]=reject;
 if(reject!=0u){
  atomicAdd(&state[${ST_REJECTED}u],1u);
  atomicAdd(&state[${ST_REJECTED_TRIANGLES}u],b.triangles);
 }
}
`;
