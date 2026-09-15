/**
 * Le rejet par face d'ombre : de la liste d'instances que la compaction de l'image a produite, une
 * face ne garde que les clusters dont la sphère monde touche à la fois la portée de la lampe et le
 * cône de la face. Les autres seraient de toute façon rejetés par le plan lointain — `far` vaut la
 * portée — ou par les plans latéraux de la projection : l'atlas sort texel pour texel identique.
 *
 * La liste source est celle du dessin principal, sélection comprise : la passe d'ombres voit donc
 * exactement les mêmes clusters qu'avant, jamais un de plus.
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

/** Les instances vivantes de l'image : la somme des commandes indirectes, contiguës depuis zéro. */
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

/** Une instance, une face : gardée ou non. L'ordre du résultat est libre — la carte garde un
 *  minimum de profondeur, et un minimum ne dépend pas de l'ordre des écritures. */
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
