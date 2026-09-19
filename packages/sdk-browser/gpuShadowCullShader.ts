/**
 * Per-shadow-face reject: from the instance list the frame compact produced, a face keeps only
 * clusters whose world sphere touches both the light's range and the face's cone. The others
 * would be rejected anyway by the far plane — `far` is the range — or by the projection's side
 * planes: the atlas comes out texel-for-texel identical.
 *
 * The source list is that of the main draw, selection included: the shadow pass therefore sees
 * exactly the same clusters as before, never one more.
 */
export const SHADOW_CULL_SHADER = `struct Sphere{center:vec3f,radius:f32,}
struct Face{center:vec3f,far:f32,axis:vec3f,halfAngle:f32,}
struct Uni{faces:u32,slots:u32,maxVertexCount:u32,capacity:u32,}
@group(0) @binding(0) var<storage, read> spheres:array<Sphere>;
@group(0) @binding(1) var<storage, read> source:array<u32>;
@group(0) @binding(2) var<storage, read> sourceIndirect:array<u32>;
@group(0) @binding(3) var<storage, read_write> kept:array<u32>;
@group(0) @binding(4) var<storage, read_write> indirect:array<atomic<u32>>;
@group(0) @binding(5) var<uniform> uni:Uni;
@group(0) @binding(6) var<storage, read> faces:array<Face>;
@group(0) @binding(7) var<storage, read_write> live:array<u32>;

/** Live instances of the frame: the sum of the indirect commands, contiguous from zero. */
@compute @workgroup_size(1)
fn shadowCullPrepare(){
 var sum=0u;
 for(var slot=0u;slot<uni.slots;slot++){sum=sum+sourceIndirect[slot*4u+1u];}
 live[0]=min(sum,uni.capacity);
 for(var face=0u;face<uni.faces;face++){
  atomicStore(&indirect[face*4u],uni.maxVertexCount);
  atomicStore(&indirect[face*4u+1u],0u);
  atomicStore(&indirect[face*4u+2u],0u);
  atomicStore(&indirect[face*4u+3u],0u);
 }
}

/** One instance, one face: kept or not. Result order is free — the GPU keeps a depth
 *  minimum, and a minimum does not depend on write order. */
@compute @workgroup_size(64)
fn shadowCullScatter(@builtin(global_invocation_id) id:vec3u){
 let index=id.x;let face=id.y;
 if(face>=uni.faces||index>=live[0]){return;}
 let row=source[index];
 let sphere=spheres[row];
 let volume=faces[face];
 let delta=sphere.center-volume.center;
 let distance=length(delta);
 if(distance-sphere.radius>volume.far){return;}
 if(volume.halfAngle<3.14159&&distance>sphere.radius){
  let axis=clamp(dot(delta,volume.axis)/distance,-1.0,1.0);
  if(acos(axis)-asin(clamp(sphere.radius/distance,0.0,1.0))>volume.halfAngle){return;}
 }
 let rank=atomicAdd(&indirect[face*4u+1u],1u);
 kept[face*uni.capacity+rank]=row;
}
`;
