/**
 * Per-shadow-region reject: from the instance list the LIGHT CUT of the region's face produced,
 * a region keeps only clusters whose world sphere touches its volume — for a perspective face,
 * the light's range and the region's cone; for a sun page, the box the page cuts in the
 * extent, its rectangle on the light plane by the whole depth of the map, flagged by a negative
 * half-angle. The others would be rejected anyway by the far plane or by the projection's side
 * planes and the scissor: the atlas comes out texel-for-texel identical.
 *
 * One dispatch per redrawn face, right after that face's light cut: `firstFace` and `faces` name
 * its regions, `sourceBase` where its list starts, and the `commands` indirect commands from
 * `indirectBase` how long it is — the light compaction's slots, or the one command a list the
 * CPU cut wrote carries. The kept counts start at zero: the host writes the frame's commands
 * before the command buffer runs.
 */
export const SHADOW_CULL_SHADER = `struct Sphere{center:vec3f,radius:f32,}
struct Face{center:vec3f,far:f32,axis:vec3f,halfAngle:f32,right:vec3f,halfU:f32,up:vec3f,halfV:f32,}
struct Uni{firstFace:u32,faces:u32,sourceBase:u32,indirectBase:u32,commands:u32,capacity:u32,pad0:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read> spheres:array<Sphere>;
@group(0) @binding(1) var<storage, read> source:array<u32>;
@group(0) @binding(2) var<storage, read> sourceIndirect:array<u32>;
@group(0) @binding(3) var<storage, read_write> kept:array<u32>;
@group(0) @binding(4) var<storage, read_write> indirect:array<atomic<u32>>;
@group(0) @binding(5) var<uniform> uni:Uni;
@group(0) @binding(6) var<storage, read> faces:array<Face>;

/** Instances of the face's list: the sum of its commands, contiguous from \`sourceBase\`. */
fn listed()->u32{
 var sum=0u;
 for(var command=0u;command<uni.commands;command++){sum=sum+sourceIndirect[uni.indirectBase+command*4u+1u];}
 return min(sum,uni.capacity);
}

/** One instance, one region: kept or not. Result order is free — the GPU keeps a depth
 *  minimum, and a minimum does not depend on write order. */
@compute @workgroup_size(64)
fn shadowCullScatter(@builtin(global_invocation_id) id:vec3u){
 let index=id.x;
 if(id.y>=uni.faces||index>=listed()){return;}
 let face=uni.firstFace+id.y;
 let row=source[uni.sourceBase+index];
 let sphere=spheres[row];
 let volume=faces[face];
 let delta=sphere.center-volume.center;
 if(volume.halfAngle<0.0){
  let local=abs(vec3f(dot(delta,volume.right),dot(delta,volume.up),dot(delta,volume.axis)));
  let gap=max(local-vec3f(volume.halfU,volume.halfV,volume.far),vec3f(0.0));
  if(dot(gap,gap)>sphere.radius*sphere.radius){return;}
 }else{
  let distance=length(delta);
  if(distance-sphere.radius>volume.far){return;}
  if(volume.halfAngle<3.14159&&distance>sphere.radius){
   let axis=clamp(dot(delta,volume.axis)/distance,-1.0,1.0);
   if(acos(axis)-asin(clamp(sphere.radius/distance,0.0,1.0))>volume.halfAngle){return;}
  }
 }
 let rank=atomicAdd(&indirect[face*4u+1u],1u);
 kept[face*uni.capacity+rank]=row;
}
`;
